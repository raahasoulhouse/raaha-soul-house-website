/* RAAHA admin — shared core: sign-in, tabs, helpers and the content (draft) store.
   Every read and write is checked by Supabase: only the allowlisted admin account can see
   or change bookings, drafts and photos. */
(function () {
  'use strict';
  var cfg = window.RAAHA_CONFIG;
  var db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
    auth: { persistSession: true, storageKey: 'raaha-admin-auth' }
  });

  var A = window.RAAHA_ADMIN = { db: db, cfg: cfg, modules: [] };

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
      .select('id,collection,key,sort,draft,draft_deleted,published,published_source,updated_at')
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
  A.draftBadge = function (row) {
    if (!row) return A.el('span', 'Not saved yet', 'badge draft');
    if (row.published_source == null) return A.el('span', 'New — not published', 'badge draft');
    if (store.isChanged(row)) return A.el('span', 'Draft — not published', 'badge draft');
    return A.el('span', 'Published', 'badge ok');
  };

  // ---------- publish bar ----------
  A.refreshPublishBar = function () {
    var changed = store.rows.filter(store.isChanged).length;
    var s = A.$('pub-status');
    if (!s) return;
    s.textContent = changed ? changed + ' unpublished change' + (changed === 1 ? '' : 's') + ' (drafts are private)'
                            : 'Everything is published to the preview site.';
    A.$('publish-bar').classList.toggle('has-changes', changed > 0);
    A.$('pub-publish').disabled = changed === 0;
    A.$('pub-discard').disabled = changed === 0;
  };

  // ---------- tabs ----------
  A.showTab = function (name) {
    document.querySelectorAll('.tabs [data-tab]').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-tab') === name);
      b.setAttribute('aria-selected', b.getAttribute('data-tab') === name ? 'true' : 'false');
    });
    document.querySelectorAll('.tab-panel').forEach(function (p) { p.hidden = p.id !== 'tab-' + name; });
    A.$('publish-bar').hidden = ['bookings', 'reports'].indexOf(name) !== -1;
    A.modules.forEach(function (m) { if (m.tab === name && m.onShow) m.onShow(); });
    try { sessionStorage.setItem('raaha-admin-tab', name); } catch (e) {}
  };
  document.querySelectorAll('.tabs [data-tab]').forEach(function (b) {
    b.addEventListener('click', function () { A.showTab(b.getAttribute('data-tab')); });
  });
})();
