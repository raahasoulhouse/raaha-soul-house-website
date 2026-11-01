/* RAAHA admin — shared core: sign-in, tabs, helpers and the content (draft) store.
   Every read and write is checked by Supabase: only the allowlisted admin account can see
   or change bookings, drafts and photos. */
(function () {
  'use strict';
  var cfg = window.RAAHA_CONFIG;
  // Read before the sign-in library processes (and clears) a password-reset link
  var initialHash = location.hash || '';
  var db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
    auth: { persistSession: true, storageKey: 'raaha-admin-auth' }
  });

  var A = window.RAAHA_ADMIN = { db: db, cfg: cfg, modules: [], initialHash: initialHash };

  // ---------- helpers ----------
  A.$ = function (id) { return document.getElementById(id); };
  A.el = function (tag, text, cls) {
    var e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };
  A.today = function () {
    var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };
  A.fmtDate = function (d) {
    if (!d) return '—';
    var x = new Date(String(d).length === 10 ? d + 'T12:00:00' : d);
    return x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  A.fmtDateTime = function (d) {
    return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  };
  A.money = function (n) {
    return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  A.toast = function (text, isError) {
    var t = A.$('toast');
    t.textContent = text; t.hidden = false; t.className = 'toast' + (isError ? ' is-error' : '');
    clearTimeout(A._toastTimer);
    A._toastTimer = setTimeout(function () { t.hidden = true; }, isError ? 7000 : 3500);
  };
  A.field = function (labelText, input, wide) {
    var l = A.el('label', null, wide ? 'wide' : '');
    l.appendChild(document.createTextNode(labelText));
    l.appendChild(input);
    return l;
  };
  A.input = function (type, value, attrs) {
    var i = document.createElement(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') i.type = type;
    i.value = value == null ? '' : value;
    Object.keys(attrs || {}).forEach(function (k) { i.setAttribute(k, attrs[k]); });
    return i;
  };
  A.csv = function (rows) {
    if (!rows.length) return '';
    var cols = Object.keys(rows[0]);
    var esc = function (v) {
      if (v == null) return '';
      var s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      if (/^[=+\-@]/.test(s)) s = "'" + s; // stop spreadsheet formulas from running
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [cols.join(',')].concat(rows.map(function (r) { return cols.map(function (c) { return esc(r[c]); }).join(','); })).join('\n');
  };
  A.download = function (name, text) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
  };
  // Only allow buttons to point inside the website, to secure https pages, email or phone
  A.safeHref = function (h) { return /^(\/|#|https:\/\/|mailto:|tel:)/.test(String(h || '').trim()); };

  // ---------- content store (drafts) ----------
  var store = A.content = { rows: [], loaded: false };
  function same(a, b) { return JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b); }
  store.isChanged = function (r) { return r.draft_deleted || !same(r.draft, r.published_source); };
  store.load = function () {
    return db.from('cms_entries')
      .select('id,collection,key,sort,draft,draft_deleted,published,published_source,live_source,updated_at')
      .order('sort').order('id')
      .then(function (res) {
        if (res.error) throw res.error;
        store.rows = res.data; store.loaded = true;
        A.refreshPublishBar();
        return store.rows;
      });
  };
  store.byKey = function (collection, key) {
    return store.rows.filter(function (r) { return r.collection === collection && r.key === key; })[0];
  };
  store.list = function (collection) {
    return store.rows.filter(function (r) { return r.collection === collection && !r.draft_deleted; })
      .sort(function (a, b) { return a.sort - b.sort; });
  };
  store.saveDraft = function (row, draft) {
    return db.from('cms_entries').update({ draft: draft }).eq('id', row.id).select().then(function (res) {
      if (res.error) throw res.error;
      Object.assign(row, res.data[0]);
      A.refreshPublishBar();
      return row;
    });
  };
  store.saveNamed = function (collection, key, draft) {
    var row = store.byKey(collection, key);
    if (row) return store.saveDraft(row, draft);
    return db.from('cms_entries').insert({ collection: collection, key: key, sort: 0, draft: draft }).select().then(function (res) {
      if (res.error) throw res.error;
      store.rows.push(res.data[0]); A.refreshPublishBar(); return res.data[0];
    });
  };
  store.add = function (collection, draft) {
    var items = store.list(collection);
    var sort = items.length ? items[items.length - 1].sort + 10 : 10;
    return db.from('cms_entries').insert({ collection: collection, sort: sort, draft: draft }).select().then(function (res) {
      if (res.error) throw res.error;
      store.rows.push(res.data[0]); A.refreshPublishBar(); return res.data[0];
    });
  };
  store.remove = function (row) {
    // never published: delete outright; otherwise mark for removal at the next publish
    var q = row.published_source == null
      ? db.from('cms_entries').delete().eq('id', row.id)
      : db.from('cms_entries').update({ draft_deleted: true }).eq('id', row.id);
    return q.then(function (res) {
      if (res.error) throw res.error;
      if (row.published_source == null) store.rows = store.rows.filter(function (r) { return r.id !== row.id; });
      else row.draft_deleted = true;
      A.refreshPublishBar();
    });
  };
  store.move = function (row, direction) {
    var items = store.list(row.collection);
    var i = items.indexOf(row), j = i + direction;
    if (j < 0 || j >= items.length) return Promise.resolve();
    var other = items[j], a = row.sort, b = other.sort;
    if (a === b) b = a + direction;
    return Promise.all([
      db.from('cms_entries').update({ sort: b }).eq('id', row.id),
      db.from('cms_entries').update({ sort: a }).eq('id', other.id)
    ]).then(function (r) {
      if (r[0].error || r[1].error) throw (r[0].error || r[1].error);
      row.sort = b; other.sort = a;
    });
  };
  // Publishing status of one item. Shows what is on the live website now, plus any unpublished draft.
  //   Live — the live website shows this version
  //   Preview only — published to the preview site, not yet to the live website
  //   Unpublished draft — saved changes visible only in "Preview drafts"
  store.liveState = function (row) {
    if (!row) return 'builtin';
    // a named slot (page photo, heading…) that was never published still shows its built-in content live
    if (row.published_source == null) return row.live_source != null ? 'preview' : (row.key ? 'builtin' : 'none');
    return same(row.published_source, row.live_source) ? 'live' : 'preview';
  };
  A.draftBadge = function (row) {
    var box = A.el('span', null, 'status-badges');
    function b(text, cls, tip) { var s = A.el('span', text, 'badge ' + cls); s.title = tip; box.appendChild(s); }
    if (!row) { b('Live', 'ok', 'The live website shows the photo or text built into the page. Nothing has been changed here.'); return box; }
    if (row.draft_deleted) b('Removal not live yet', 'draft', 'You removed this item, but the removal has not reached the website yet. Use “Make them live” in the bar above, or Save again.');
    else if (store.isChanged(row)) b('Saved, not live yet', 'draft', 'This change was saved earlier but has not reached the website. Use “Make them live” in the bar above, or Save again.');
    var st = store.liveState(row);
    if (st === 'live') b('Live', 'ok', 'This version is on the live website.');
    else if (st === 'builtin') b('Live', 'ok', 'The live website still shows the photo or text built into the page.');
    else if (st === 'preview') b('Not live yet', 'preview', 'Not on the live website yet. Use “Make them live” in the bar above, or Save again.');
    else if (!row.draft_deleted) b('Not on website', 'muted', 'Not published anywhere yet.');
    return box;
  };

  // ---------- status bar ----------
  // Save = live. The bar only appears when something saved earlier has not reached the live website.
  store.pending = function () {
    return store.rows.filter(function (r) { return store.isChanged(r) || store.liveState(r) === 'preview'; });
  };
  A.refreshPublishBar = function () {
    var s = A.$('pub-status');
    if (!s) return;
    var waiting = store.pending().length;
    s.textContent = waiting
      ? waiting + ' saved change' + (waiting === 1 ? ' is' : 's are') + ' not on the live website yet.'
      : 'Every saved change is live on raahasoulhouse.com.';
    A.$('publish-bar').classList.toggle('has-changes', waiting > 0);
    A.$('pub-publish').hidden = A.$('pub-discard').hidden = waiting === 0;
  };

  // ---------- Save → live ----------
  // targets: the content rows this save is about (may include undefined for slots never saved before).
  // Other rows with changes that are not live yet are never published silently: they are listed first,
  // and you choose to discard them, include them, or cancel.
  A.saveLive = function (targets, saveFn) {
    targets = (targets || []).filter(Boolean);
    var others = store.pending().filter(function (r) { return targets.indexOf(r) === -1; });
    var first = others.length ? A.resolveOthers(others) : Promise.resolve('none');
    return first.then(function (choice) {
      if (choice === 'cancel') return { cancelled: true };
      return Promise.resolve(saveFn ? saveFn() : null).then(function () {
        return A.publishLive();
      }).then(function (r) { return r; }, function (e) {
        // the change is saved but not live: the bar offers “Make them live”
        return store.load().then(function () { throw e; });
      });
    });
  };
  A.resolveOthers = function (rows) {
    return new Promise(function (resolve) {
      var dlg = A.$('others-dialog'), ul = A.$('others-list');
      ul.textContent = '';
      rows.forEach(function (r) { ul.appendChild(A.el('li', store.describe ? store.describe(r) : r.collection)); });
      function done(v) { dlg.onclose = null; dlg.close(); resolve(v); }
      A.$('others-cancel').onclick = function () { done('cancel'); };
      A.$('others-include').onclick = function () { done('include'); };
      A.$('others-discard').onclick = function () {
        A.$('others-discard').disabled = true;
        store.discardRows(rows).then(function () { A.$('others-discard').disabled = false; done('discarded'); },
          function (e) { A.$('others-discard').disabled = false; A.toast('Could not discard: ' + e.message, true); });
      };
      dlg.onclose = function () { resolve('cancel'); };
      dlg.showModal();
    });
  };
  // Discard only these rows' unsaved-to-live changes (back to what the live website shows)
  store.discardRows = function (rows) {
    return Promise.all(rows.map(function (r) {
      if (r.published_source == null && r.live_source == null) {
        return db.from('cms_entries').delete().eq('id', r.id).then(function (res) { if (res.error) throw res.error; });
      }
      return db.from('cms_entries').update({ draft: r.live_source != null ? r.live_source : r.published_source, draft_deleted: false })
        .eq('id', r.id).then(function (res) { if (res.error) throw res.error; });
    })).then(function () { return store.load(); });
  };

  // ---------- navigation: left sidebar (Operations, Website, Reports, History, Settings) ----------
  var TITLES = { overview: 'Booking dashboard', bookings: 'Bookings', calendar: 'Calendar', quotes: 'Quotes', content: 'Pages', menu: 'Menu', cart: 'Coffee Cart selection', events: 'Events',
    media: 'Photo library', reports: 'Reports', publishing: 'History', settings: 'Settings' };
  A.tabExists = function (name) { return !!document.querySelector('.side-nav [data-tab="' + name + '"]'); };
  A.showTab = function (name, opts) {
    if (!A.tabExists(name)) name = 'overview';
    document.querySelectorAll('.side-nav [data-tab]').forEach(function (b) {
      var on = b.getAttribute('data-tab') === name;
      b.classList.toggle('is-active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    document.querySelectorAll('.tab-panel').forEach(function (p) { p.hidden = p.id !== 'tab-' + name; });
    A.$('screen-title').textContent = TITLES[name] || '';
    // the live-status bar belongs to the website screens
    A.$('publish-bar').hidden = ['overview', 'bookings', 'calendar', 'quotes', 'reports', 'settings'].indexOf(name) !== -1;
    A.modules.forEach(function (m) { if (m.tab === name && m.onShow) m.onShow(); });
    try { sessionStorage.setItem('raaha-admin-tab', name); } catch (e) {}
    if (!(opts && opts.fromHash) && location.hash !== '#/' + name) {
      try { history.replaceState(null, '', '#/' + name); } catch (e) { location.hash = '#/' + name; }
    }
    A.closeSide();
  };
  A.tabFromHash = function () { var m = /^#\/([a-z]+)/.exec(location.hash || ''); return m && A.tabExists(m[1]) ? m[1] : null; };
  document.querySelectorAll('.side-nav [data-tab]').forEach(function (b) {
    b.addEventListener('click', function () {
      var name = b.getAttribute('data-tab');
      if (location.hash !== '#/' + name) { try { history.pushState(null, '', '#/' + name); } catch (e) {} }
      A.showTab(name, { fromHash: true });
    });
  });
  window.addEventListener('popstate', function () { var t = A.tabFromHash(); if (t && !A.$('app-view').hidden) A.showTab(t, { fromHash: true }); });

  // phones: the sidebar opens as a drawer
  var side = A.$('side'), scrim = A.$('side-scrim'), toggle = A.$('side-toggle');
  A.closeSide = function () {
    document.body.classList.remove('side-open');
    if (scrim) scrim.hidden = true;
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  };
  if (toggle) toggle.addEventListener('click', function () {
    var open = !document.body.classList.contains('side-open');
    document.body.classList.toggle('side-open', open);
    scrim.hidden = !open;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { var a = side.querySelector('.is-active') || side.querySelector('button'); if (a) a.focus(); }
  });
  if (scrim) scrim.addEventListener('click', A.closeSide);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && document.body.classList.contains('side-open')) { A.closeSide(); toggle.focus(); } });
})();
