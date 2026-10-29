/* RAAHA admin portal — Coffee Cart inquiries (minimum working version).
   All data access is enforced by Supabase row-level security: only the allowlisted,
   email-confirmed admin account can read or change anything. */
(function () {
  'use strict';
  var cfg = window.RAAHA_CONFIG;
  var db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
    auth: { persistSession: true, storageKey: 'raaha-admin-auth' }
  });

  var STATUS_LABEL = {
    new: 'New', contacted: 'Contacted', quoted: 'Quoted', confirmed: 'Confirmed',
    completed: 'Completed', declined: 'Declined', lost: 'Lost'
  };
  var ACTIVE = ['new', 'contacted', 'quoted', 'confirmed'];
  var BOOKED = ['confirmed', 'completed'];

  var $ = function (id) { return document.getElementById(id); };
  var rows = [];
  var current = null;

  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function fmtDate(d) {
    if (!d) return '—';
    var x = new Date(d.length === 10 ? d + 'T12:00:00' : d);
    return x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function money(n) { return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
  function sourceOf(r) {
    if (r.heard_about) return r.heard_about;
    if (r.utm_source) return r.utm_source;
    if (r.referrer) { try { return new URL(r.referrer).hostname.replace(/^www\./, ''); } catch (e) {} }
    return 'Not given';
  }

  // ---------- auth ----------
  function show(view) {
    $('login-view').hidden = view !== 'login';
    $('app-view').hidden = view !== 'app';
    $('sign-out').hidden = view !== 'app';
  }

  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    $('login-msg').textContent = 'Signing in…';
    db.auth.signInWithPassword({ email: $('login-email').value.trim(), password: $('login-password').value })
      .then(function (res) {
        if (res.error) { $('login-msg').textContent = 'Sign-in failed: check the email and password.'; return; }
        $('login-password').value = '';
        $('login-msg').textContent = '';
        start();
      });
  });
  $('sign-out').addEventListener('click', function () {
    db.auth.signOut().then(function () { rows = []; show('login'); });
  });

  // ---------- data ----------
  function load() {
    return db.from('inquiries').select('*').order('created_at', { ascending: false }).then(function (res) {
      if (res.error) { alert('Could not load inquiries: ' + res.error.message); return; }
      rows = res.data || [];
      render();
    });
  }

  function visible() {
    var st = $('f-status').value;
    var tests = $('f-tests').checked;
    return rows.filter(function (r) {
      if (!tests && r.is_test) return false;
      if (st === 'all') return true;
      if (st === 'active') return ACTIVE.indexOf(r.status) !== -1;
      return r.status === st;
    });
  }

  function render() {
    var tests = $('f-tests').checked;
    var base = rows.filter(function (r) { return tests || !r.is_test; });
    var t = today();
    $('s-new').textContent = base.filter(function (r) { return r.status === 'new'; }).length;
    $('s-open').textContent = base.filter(function (r) { return r.status === 'contacted' || r.status === 'quoted'; }).length;
    $('s-confirmed').textContent = base.filter(function (r) { return r.status === 'confirmed'; }).length;
    $('s-overdue').textContent = base.filter(function (r) { return r.follow_up_on && r.follow_up_on <= t && ACTIVE.indexOf(r.status) !== -1; }).length;
    var booked = base.filter(function (r) { return BOOKED.indexOf(r.status) !== -1; }).length;
    $('s-rate').textContent = base.length ? Math.round(100 * booked / base.length) + '%' : '–';

    // reports
    var bySource = {}, byMonth = {};
    base.forEach(function (r) {
      var s = sourceOf(r), m = r.created_at.slice(0, 7), b = BOOKED.indexOf(r.status) !== -1;
      bySource[s] = bySource[s] || [0, 0]; bySource[s][0]++; if (b) bySource[s][1]++;
      byMonth[m] = byMonth[m] || [0, 0, 0]; byMonth[m][0]++; if (b) { byMonth[m][1]++; byMonth[m][2] += Number(r.quote_amount || 0); }
    });
    fillTable('r-source', Object.keys(bySource).sort(function (a, b) { return bySource[b][0] - bySource[a][0]; })
      .map(function (k) { return [k, bySource[k][0], bySource[k][1]]; }));
    fillTable('r-month', Object.keys(byMonth).sort().reverse().map(function (k) {
      var d = new Date(k + '-15T12:00:00');
      return [d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), byMonth[k][0], byMonth[k][1], money(byMonth[k][2])];
    }));

    // list
    var tbody = $('list').querySelector('tbody');
    tbody.textContent = '';
    var list = visible();
    if (!list.length) {
      var tr = el('tr'); var td = el('td', 'No inquiries match this view yet.', 'empty'); td.colSpan = 7; tr.appendChild(td); tbody.appendChild(tr);
    }
    list.forEach(function (r) {
      var tr = el('tr');
      tr.tabIndex = 0;
      if (current && current.id === r.id) tr.className = 'selected';
      [fmtDate(r.created_at), r.name + (r.is_test ? ' (test)' : ''), r.event_type || '—', fmtDate(r.event_date),
       r.guest_count || '—'].forEach(function (v) { tr.appendChild(el('td', v)); });
      var stTd = el('td'); stTd.appendChild(el('span', STATUS_LABEL[r.status], 'pill ' + r.status)); tr.appendChild(stTd);
      var due = r.follow_up_on && r.follow_up_on <= t && ACTIVE.indexOf(r.status) !== -1;
      tr.appendChild(el('td', r.follow_up_on ? fmtDate(r.follow_up_on) + (due ? ' • due' : '') : '—', due ? 'due' : ''));
      tr.addEventListener('click', function () { open(r.id); });
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(r.id); });
      tbody.appendChild(tr);
    });
  }

  function fillTable(id, data) {
    var tb = $(id).querySelector('tbody'); tb.textContent = '';
    if (!data.length) { var tr = el('tr'); var td = el('td', 'No data yet', 'empty'); td.colSpan = 4; tr.appendChild(td); tb.appendChild(tr); return; }
    data.forEach(function (row) { var tr = el('tr'); row.forEach(function (v) { tr.appendChild(el('td', v)); }); tb.appendChild(tr); });
  }

  // ---------- detail ----------
  function open(id) {
    current = rows.filter(function (r) { return r.id === id; })[0];
    if (!current) return;
    var r = current;
    $('detail').hidden = false;
    $('d-name').textContent = r.name + (r.is_test ? ' (test inquiry)' : '');
    $('d-meta').textContent = (r.inquiry_type === 'coffee_cart' ? 'Coffee Cart' : 'Gathering') + ' inquiry received ' + fmtDate(r.created_at);
    var dl = $('d-fields'); dl.textContent = '';
    [['Email', r.email, 'mailto:' + r.email], ['Phone', r.phone, r.phone ? 'tel:' + r.phone.replace(/[^0-9+]/g, '') : null],
     ['Event type', r.event_type], ['Event date', r.event_date ? fmtDate(r.event_date) : null], ['Guests', r.guest_count],
     ['Service', r.service_duration], ['Area', r.city_neighborhood], ['Venue', r.venue_address],
     ['Message', r.message], ['Source', sourceOf(r)],
     ['Confirmed', r.confirmed_at ? fmtDate(r.confirmed_at) + (r.confirmation_exception ? ' (exception)' : ' (deposit verified)') : null]].forEach(function (f) {
      if (f[1] == null || f[1] === '') return;
      dl.appendChild(el('dt', f[0]));
      var dd = el('dd');
      if (f[2]) { var a = el('a', String(f[1])); a.href = f[2]; dd.appendChild(a); } else { dd.textContent = String(f[1]); }
      dl.appendChild(dd);
    });
    // same-date conflicts
    if (r.event_date) {
      var clash = rows.filter(function (o) { return o.id !== r.id && o.event_date === r.event_date && BOOKED.indexOf(o.status) !== -1 && !o.is_test; });
      if (clash.length) { dl.appendChild(el('dt', 'Heads up')); dl.appendChild(el('dd', clash.length + ' confirmed booking(s) already on this date.', 'due')); }
    }
    var f = $('d-form');
    ['status', 'follow_up_on', 'quote_amount', 'deposit_amount', 'deposit_received_on', 'payment_reference', 'confirmation_exception', 'closed_reason'].forEach(function (k) {
      f.elements[k].value = r[k] == null ? '' : r[k];
    });
    $('d-msg').textContent = '';
    loadNotes();
    render();
    $('detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  $('close-detail').addEventListener('click', function () { current = null; $('detail').hidden = true; render(); });

  $('d-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!current) return;
    var f = e.target, patch = {};
    ['status', 'follow_up_on', 'quote_amount', 'deposit_amount', 'deposit_received_on', 'payment_reference', 'confirmation_exception', 'closed_reason'].forEach(function (k) {
      var v = f.elements[k].value.trim(); patch[k] = v === '' ? null : v;
    });
    if ((patch.status === 'confirmed' || patch.status === 'completed') && !patch.confirmation_exception &&
        !(Number(patch.deposit_amount) > 0 && patch.deposit_received_on && patch.payment_reference)) {
      $('d-msg').textContent = 'To confirm, record the deposit amount, date received and payment reference — or write an approved exception.';
      return;
    }
    if ((patch.status === 'declined' || patch.status === 'lost') && !patch.closed_reason) {
      $('d-msg').textContent = 'Add a short reason so reporting stays useful.';
      return;
    }
    $('d-msg').textContent = 'Saving…';
    db.from('inquiries').update(patch).eq('id', current.id).select().then(function (res) {
      if (res.error || !res.data || !res.data.length) { $('d-msg').textContent = 'Not saved: ' + (res.error ? res.error.message : 'no permission'); return; }
      var updated = res.data[0];
      rows = rows.map(function (r) { return r.id === updated.id ? updated : r; });
      current = updated;
      $('d-msg').textContent = 'Saved.';
      render();
    });
  });

  function loadNotes() {
    var ol = $('d-notes'); ol.textContent = '';
    db.from('inquiry_notes').select('*').eq('inquiry_id', current.id).order('created_at').then(function (res) {
      if (res.error) { ol.appendChild(el('li', 'Could not load notes.')); return; }
      if (!res.data.length) ol.appendChild(el('li', 'No notes yet.', 'muted'));
      res.data.forEach(function (n) {
        var li = el('li'); li.appendChild(el('span', fmtDate(n.created_at), 'muted')); li.appendChild(el('p', n.body)); ol.appendChild(li);
      });
    });
  }

  $('note-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var body = $('note-body').value.trim();
    if (!body || !current) return;
    db.from('inquiry_notes').insert({ inquiry_id: current.id, body: body }).then(function (res) {
      if (res.error) { alert('Note not saved: ' + res.error.message); return; }
      $('note-body').value = '';
      loadNotes();
    });
  });

  // ---------- backup ----------
  $('export').addEventListener('click', function () {
    Promise.all([
      db.from('inquiries').select('*').order('created_at'),
      db.from('inquiry_notes').select('*').order('created_at')
    ]).then(function (res) {
      if (res[0].error || res[1].error) { alert('Export failed.'); return; }
      download('raaha-inquiries-' + today() + '.csv', toCsv(res[0].data));
      download('raaha-inquiry-notes-' + today() + '.csv', toCsv(res[1].data));
    });
  });
  function toCsv(data) {
    if (!data.length) return '';
    var cols = Object.keys(data[0]);
    var esc = function (v) {
      if (v == null) return '';
      var s = String(v);
      if (/^[=+\-@]/.test(s)) s = "'" + s; // keep spreadsheet formulas from running
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [cols.join(',')].concat(data.map(function (r) { return cols.map(function (c) { return esc(r[c]); }).join(','); })).join('\n');
  }
  function download(name, text) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }

  $('f-status').addEventListener('change', render);
  $('f-tests').addEventListener('change', render);
  $('refresh').addEventListener('click', load);

  // ---------- start ----------
  function start() {
    show('app');
    load();
  }
  if (cfg.productionHosts.indexOf(location.hostname) === -1) {
    $('env-badge').hidden = false;
    $('env-badge').textContent = 'Preview';
  }
  db.auth.getSession().then(function (res) {
    if (res.data && res.data.session) start(); else show('login');
  });
})();
