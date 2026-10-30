/* RAAHA admin — Publish, discard, history/undo. Publishing updates the PREVIEW website only.
   Before publishing, every photo the drafts use gets a public copy; afterwards, public copies no
   longer used by the preview or production website are removed. */
(function () {
  'use strict';
  var A = window.RAAHA_ADMIN, $ = A.$, el = A.el, db = A.db, C = A.content;
  var FOLDERS = ['general', 'homepage', 'menu', 'events', 'gallery', 'coffee-cart'];

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

  // Public files that preview or production still reference
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
  function listPublic() {
    return Promise.all(FOLDERS.map(function (f) {
      return db.storage.from('site-media').list(f, { limit: 1000 }).then(function (r) {
        return (r.data || []).filter(function (x) { return x.id; }).map(function (x) { return f + '/' + x.name; });
      });
    })).then(function (lists) { return [].concat.apply([], lists); });
  }
  function cleanupPublic() {
    return Promise.all([referencedPaths(), listPublic()]).then(function (r) {
      var keep = r[0], unused = r[1].filter(function (p) { return !keep[p]; });
      var chain = unused.length ? db.storage.from('site-media').remove(unused) : Promise.resolve();
      return chain.then(function () {
        var stale = A.media.rows.filter(function (m) { return m.public_copy && !keep[m.path]; });
        return Promise.all(stale.map(function (m) {
          return db.from('media').update({ public_copy: false }).eq('id', m.id).then(function () { m.public_copy = false; });
        }));
      });
    });
  }
  // After an undo, published content may point at older photo files: make sure they're public again
  function restorePublic() {
    return Promise.all([referencedPaths(), listPublic()]).then(function (r) {
      var have = {}; r[1].forEach(function (p) { have[p] = true; });
      var missing = Object.keys(r[0]).filter(function (p) { return !have[p]; });
      return missing.reduce(function (p, path) { return p.then(function () { return copyToPublic(path).catch(function () {}); }); }, Promise.resolve());
    });
  }

  function busy(on, text) {
    ['pub-publish', 'pub-discard'].forEach(function (id) { $(id).disabled = on; });
    if (text) $('pub-status').textContent = text;
  }
  function reloadAll() {
    return Promise.all([C.load(), A.media.load()]).then(function () {
      var active = document.querySelector('.tabs .is-active');
      if (active) A.showTab(active.getAttribute('data-tab'));
    });
  }

  $('pub-publish').addEventListener('click', function () {
    var n = C.rows.filter(C.isChanged).length;
    if (!confirm('Publish ' + n + ' change(s) to the PREVIEW website?\n\nThe production website (raahasoulhouse.com) is not affected.')) return;
    busy(true, 'Publishing…');
    preparePhotos()
      .then(function () { return db.rpc('publish_site'); })
      .then(function (res) {
        if (res.error) throw res.error;
        return cleanupPublic().catch(function () {}).then(function () { return res.data; });
      })
      .then(function (r) {
        A.toast('Published to the preview website: ' + r.changed + ' updated, ' + r.removed + ' removed.');
        return reloadAll().then(loadHistory);
      })
      .catch(function (e) { A.toast('Not published: ' + e.message, true); A.refreshPublishBar(); });
  });

  $('pub-discard').addEventListener('click', function () {
    if (!confirm('Discard all unpublished drafts? Website content goes back to what is published now. Photos in the library are kept.')) return;
    busy(true, 'Discarding drafts…');
    db.rpc('discard_drafts').then(function (res) {
      if (res.error) throw res.error;
      A.toast('Drafts discarded.');
      return reloadAll();
    }).catch(function (e) { A.toast(e.message, true); A.refreshPublishBar(); });
  });

  function loadHistory() {
    var tb = $('pub-history').querySelector('tbody');
    return db.from('publish_log').select('id,published_at,target,changed,removed').order('id', { ascending: false }).limit(25).then(function (res) {
      tb.textContent = '';
      if (res.error) { tb.appendChild(el('tr')).appendChild(el('td', 'Could not load history.')); return; }
      if (!res.data.length) { var tr0 = el('tr'); var td0 = el('td', 'Nothing published from the admin yet.', 'empty'); td0.colSpan = 4; tr0.appendChild(td0); tb.appendChild(tr0); }
      res.data.forEach(function (h) {
        var tr = el('tr');
        tr.appendChild(el('td', A.fmtDateTime(h.published_at)));
        tr.appendChild(el('td', { preview: 'Published to preview', rollback: 'Undo', production: 'Published to production' }[h.target]));
        tr.appendChild(el('td', h.target === 'rollback' ? '—' : h.changed + ' updated, ' + h.removed + ' removed'));
        var td = el('td');
        if (h.target !== 'production') {
          var b = el('button', h.target === 'rollback' ? 'Redo (undo the undo)' : 'Undo — restore version before this'); b.type = 'button';
          b.addEventListener('click', function () {
            if (!confirm('Restore the preview website to how it looked before this ' + (h.target === 'rollback' ? 'undo' : 'publish') + '? Your drafts are kept.')) return;
            db.rpc('rollback_preview', { p_log_id: h.id }).then(function (res2) {
              if (res2.error) throw res2.error;
              return restorePublic();
            }).then(function () { A.toast('Preview website restored.'); return reloadAll().then(loadHistory); })
              .catch(function (e) { A.toast(e.message, true); });
          });
          td.appendChild(b);
        }
        tr.appendChild(td); tb.appendChild(tr);
      });
    });
  }

  // ---------- live (production) publishing ----------
  // The database decides: only an admin can publish live, and only after the production switch
  // has been turned on (site_settings.production_publishing_enabled). This screen adds a typed confirmation.
  var liveCount = 0, liveEnabled = false;
  function same(a, b) { return JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b); }
  function loadProd() {
    return Promise.all([
      db.from('site_settings').select('production_publishing_enabled').maybeSingle(),
      db.from('cms_entries').select('id,published,live')
    ]).then(function (res) {
      liveEnabled = !!(res[0].data && res[0].data.production_publishing_enabled);
      var rows = res[1].data || [];
      liveCount = rows.filter(function (r) { return !same(r.published, r.live); }).length;
      $('prod-status').textContent = liveEnabled
        ? 'live publishing is ON. Use “Publish to live website” below.'
        : 'locked — live publishing stays off until the launch is approved. The live site keeps its built-in content.';
      var drafts = C.rows.filter(C.isChanged).length;
      $('live-diff').textContent = (liveCount ? liveCount + ' item(s) differ between the preview and the live website.' : 'The live website matches the preview website.') +
        (drafts ? ' ' + drafts + ' unpublished draft(s) will not be included.' : '');
      $('live-open').disabled = !liveEnabled || liveCount === 0;
      $('live-open').title = liveEnabled ? '' : 'Locked until the launch is approved';
    });
  }
  $('live-open').addEventListener('click', function () {
    $('live-summary').textContent = liveCount + ' item(s) on the preview website will be copied to raahasoulhouse.com.';
    $('live-confirm').value = ''; $('live-go').disabled = true;
    $('live-dialog').showModal(); $('live-confirm').focus();
  });
  $('live-confirm').addEventListener('input', function () { $('live-go').disabled = $('live-confirm').value.trim() !== 'PUBLISH'; });
  $('live-cancel').addEventListener('click', function () { $('live-dialog').close(); });
  $('live-go').addEventListener('click', function () {
    if ($('live-confirm').value.trim() !== 'PUBLISH') return;
    $('live-go').disabled = true; $('live-go').textContent = 'Publishing…';
    db.rpc('publish_production').then(function (res) {
      $('live-go').textContent = 'Publish to live website';
      $('live-dialog').close();
      if (res.error) { A.toast('Not published to live: ' + res.error.message, true); return; }
      A.toast('Published to the live website: ' + res.data.changed + ' item(s) updated.');
      loadHistory(); loadProd();
    });
  });

  // ---------- backup ----------
  $('backup').addEventListener('click', function () {
    var tables = ['site_settings', 'cms_entries', 'media', 'publish_log', 'inquiries', 'inquiry_notes'];
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

  A.modules.push({ tab: 'publishing', onShow: function () { loadHistory(); loadProd(); } });
})();
