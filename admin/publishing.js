/* RAAHA admin — Save → live, history and undo.
   Every Save publishes straight to the live website using the existing database functions
   (publish_site, then publish_production). Each of those records a full snapshot in publish_log,
   so every change can be undone from History. Photos are never deleted here. */
(function () {
  'use strict';
  var A = window.RAAHA_ADMIN, $ = A.$, el = A.el, db = A.db, C = A.content;

  function copyToPublic(path) {
    var pub = db.storage.from('site-media');
    return db.storage.from('media-private').copy(path, path, { destinationBucket: 'site-media' }).then(function (r) {
      if (!r.error) return;
      // already there (e.g. republish): replace it
      return pub.remove([path]).then(function () {
        return db.storage.from('media-private').copy(path, path, { destinationBucket: 'site-media' });
      }).then(function (r2) { if (r2.error) throw new Error('Photo copy failed: ' + r2.error.message); });
    });
  }

  // Every photo used by saved content needs a public copy before it can be shown
  function preparePhotos() {
    var ids = {};
    C.rows.forEach(function (r) { if (!r.draft_deleted && r.draft && r.draft.media_id) ids[r.draft.media_id] = true; });
    var need = A.media.rows.filter(function (m) { return ids[m.id] && !m.public_copy; });
    return need.reduce(function (p, m) {
      return p.then(function () { return copyToPublic(m.path); })
        .then(function () { return m.thumb_path ? copyToPublic(m.thumb_path) : null; })
        .then(function () { return db.from('media').update({ public_copy: true }).eq('id', m.id); })
        .then(function (res) { if (res.error) throw res.error; m.public_copy = true; });
    }, Promise.resolve());
  }

  // After an undo, content may point at older photo files: make sure they are public again
  function referencedPaths() {
    return db.from('cms_entries').select('published,live').then(function (res) {
      if (res.error) throw res.error;
      var keep = {};
      res.data.forEach(function (r) {
        [r.published, r.live].forEach(function (v) { if (v && v.src) { keep[v.src] = true; if (v.thumb) keep[v.thumb] = true; } });
      });
      return keep;
    });
  }
  var FOLDERS = ['general', 'homepage', 'menu', 'events', 'gallery', 'coffee-cart'];
  function listPublic() {
    return Promise.all(FOLDERS.map(function (f) {
      return db.storage.from('site-media').list(f, { limit: 1000 }).then(function (r) {
        return (r.data || []).filter(function (x) { return x.id; }).map(function (x) { return f + '/' + x.name; });
      });
    })).then(function (lists) { return [].concat.apply([], lists); });
  }
  function restorePublic() {
    return Promise.all([referencedPaths(), listPublic()]).then(function (r) {
      var have = {}; r[1].forEach(function (p) { have[p] = true; });
      var missing = Object.keys(r[0]).filter(function (p) { return !have[p]; });
      return missing.reduce(function (p, path) { return p.then(function () { return copyToPublic(path).catch(function () {}); }); }, Promise.resolve());
    });
  }

  function reloadAll() {
    return Promise.all([C.load(), A.media.load()]);
  }

  // ---------- one step: saved content → live website ----------
  var running = null;
  A.publishLive = function () {
    if (running) return running;
    running = preparePhotos()
      .then(function () { return db.rpc('publish_site'); })
      .then(function (res) { if (res.error) throw res.error; return db.rpc('publish_production'); })
      .then(function (res) { if (res.error) throw res.error; return reloadAll().then(function () { return res.data; }); })
      .then(function (r) { running = null; return r; }, function (e) { running = null; throw e; });
    return running;
  };

  // Bar: only shown when something saved earlier is not live yet
  $('pub-publish').addEventListener('click', function () {
    var rows = C.pending();
    if (!confirm('Make these ' + rows.length + ' saved change(s) live on raahasoulhouse.com?\n\n• ' +
      rows.map(function (r) { return C.describe(r); }).join('\n• '))) return;
    $('pub-publish').disabled = true;
    A.publishLive().then(function () { A.toast('Live on the website.'); A.refreshView(); })
      .catch(function (e) { A.toast('Not live: ' + e.message, true); })
      .then(function () { $('pub-publish').disabled = false; });
  });
  $('pub-discard').addEventListener('click', function () {
    var rows = C.pending();
    if (!confirm('Discard these ' + rows.length + ' change(s)? They go back to what the live website shows now. Photos in the library are kept.\n\n• ' +
      rows.map(function (r) { return C.describe(r); }).join('\n• '))) return;
    C.discardRows(rows).then(function () { A.toast('Discarded.'); A.refreshView(); })
      .catch(function (e) { A.toast(e.message, true); });
  });
  // re-render whichever tab is open after data changes
  A.refreshView = function () {
    var active = document.querySelector('.side-nav .is-active');
    if (active) A.showTab(active.getAttribute('data-tab'));
  };

  // ---------- history ----------
  // Each live change = a preview publish immediately followed by a production publish.
  // Undo restores the website to how it was just before that change (later changes are undone too).
  function byId(list) { var o = {}; (list || []).forEach(function (x) { o[x.id] = x; }); return o; }
  function same(a, b) { return JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b); }
  function nameOf(item) {
    return C.describe({ collection: item.collection, key: item.key, draft: item.source || item.value || {} });
  }
  function diffNames(before, after) {
    var a = byId(before), b = byId(after), names = [];
    Object.keys(b).forEach(function (id) {
      if (!a[id]) names.push('Added: ' + nameOf(b[id]));
      else if (!same(a[id].source, b[id].source) || !same(a[id].value && a[id].value.src, b[id].value && b[id].value.src)) names.push(nameOf(b[id]));
    });
    Object.keys(a).forEach(function (id) { if (!b[id]) names.push('Removed: ' + nameOf(a[id])); });
    return names;
  }
  function currentLive() {
    return db.from('cms_entries').select('id,collection,key,live,live_source').then(function (res) {
      if (res.error) throw res.error;
      return res.data.filter(function (r) { return r.live != null; })
        .map(function (r) { return { id: r.id, collection: r.collection, key: r.key, value: r.live, source: r.live_source }; });
    });
  }

  function loadHistory() {
    var tb = $('pub-history').querySelector('tbody');
    tb.textContent = '';
    tb.appendChild(el('tr')).appendChild(el('td', 'Loading…', 'empty'));
    return Promise.all([
      db.from('publish_log').select('id,published_at,target,changed,removed,snapshot').order('id', { ascending: false }).limit(40),
      currentLive()
    ]).then(function (res) {
      tb.textContent = '';
      if (res[0].error) { tb.appendChild(el('tr')).appendChild(el('td', 'Could not load history.')); return; }
      var logs = res[0].data, live = res[1];
      var byLogId = byId(logs);
      var prods = logs.filter(function (h) { return h.target === 'production'; });
      if (!prods.length) { var tr0 = el('tr'); var td0 = el('td', 'No live changes yet.', 'empty'); td0.colSpan = 3; tr0.appendChild(td0); tb.appendChild(tr0); return; }
      prods.forEach(function (h, i) {
        var after = i === 0 ? live : prods[i - 1].snapshot;  // prods is newest first
        var names = diffNames(h.snapshot || [], after || []);
        var prev = byLogId[h.id - 1];
        var undoable = prev && (prev.target === 'preview' || prev.target === 'rollback') &&
          (new Date(h.published_at) - new Date(prev.published_at)) < 10 * 60 * 1000;
        var tr = el('tr');
        tr.appendChild(el('td', A.fmtDateTime(h.published_at)));
        var what = el('td');
        if (prev && prev.target === 'rollback') what.appendChild(el('strong', 'Undo · '));
        what.appendChild(document.createTextNode(names.length ? names.slice(0, 4).join('; ') + (names.length > 4 ? ' and ' + (names.length - 4) + ' more' : '') : 'No visible change'));
        tr.appendChild(what);
        var td = el('td');
        if (undoable && names.length) {
          var b = el('button', i === 0 ? 'Undo' : 'Restore to before this'); b.type = 'button';
          b.addEventListener('click', function () { undo(prev, i, b); });
          td.appendChild(b);
        }
        tr.appendChild(td); tb.appendChild(tr);
      });
    }).catch(function (e) { tb.textContent = ''; tb.appendChild(el('tr')).appendChild(el('td', 'Could not load history: ' + e.message)); });
  }

  function undo(prevLog, laterCount, btn) {
    var waiting = C.pending().length;
    var msg = 'Put the live website back to how it was just before this change?' +
      (laterCount ? '\n\n' + laterCount + ' later change(s) will be undone as well.' : '') +
      (waiting ? '\n\n' + waiting + ' saved change(s) that are not live yet will be discarded.' : '') +
      '\n\nThis is recorded in History, so it can be undone too.';
    if (!confirm(msg)) return;
    btn.disabled = true; btn.textContent = 'Restoring…';
    db.rpc('rollback_preview', { p_log_id: prevLog.id })
      .then(function (r) { if (r.error) throw r.error; return restorePublic(); })
      .then(function () { return db.rpc('publish_production'); })
      .then(function (r) { if (r.error) throw r.error; return db.rpc('discard_drafts'); })
      .then(function (r) { if (r.error) throw r.error; return reloadAll(); })
      .then(function () { A.toast('Done — the live website is restored.'); return loadHistory(); })
      .catch(function (e) { A.toast('Not restored: ' + e.message, true); btn.disabled = false; btn.textContent = 'Undo'; });
  }

  // ---------- backup ----------
  $('backup').addEventListener('click', function () {
    var tables = ['site_settings', 'cms_entries', 'media', 'publish_log', 'inquiries', 'inquiry_notes']
      .concat(A.ops && A.ops.ready ? ['booking_quotes', 'calendar_blocks'] : []);
    Promise.all(tables.map(function (t) { return db.from(t).select('*'); })).then(function (res) {
      var out = { app: 'RAAHA website backup', created_at: new Date().toISOString(), tables: {} };
      for (var i = 0; i < tables.length; i++) {
        if (res[i].error) { A.toast('Backup failed (' + tables[i] + '): ' + res[i].error.message, true); return; }
        out.tables[tables[i]] = res[i].data;
      }
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }));
      a.download = 'raaha-backup-' + A.today() + '.json'; document.body.appendChild(a); a.click(); a.remove();
      A.toast('Backup downloaded. Store it in a private folder.');
    });
  });

  A.modules.push({ tab: 'publishing', onShow: loadHistory });
})();
