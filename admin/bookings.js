/* RAAHA admin — Bookings: Coffee Cart and gathering inquiries.
   Status flow: Inquiry received → Contacted → Quote provided → Booking confirmed → Event completed
   (or Declined / Lost). A submission never confirms itself; confirming requires a verified deposit
   or a written exception — enforced by the database, not just this screen. */
(function () {
  'use strict';
  var A = window.RAAHA_ADMIN, $ = A.$, el = A.el;

  var STATUS_LABEL = A.STATUS_LABEL = {
    new: 'New inquiry', contacted: 'Contacted', quoted: 'Quote sent', quote_accepted: 'Quote accepted', deposit_verified: 'Deposit verified',
    confirmed: 'Booking confirmed', completed: 'Event completed', declined: 'Declined', lost: 'Lost'
  };
  var ACTIVE = A.ACTIVE = ['new', 'contacted', 'quoted', 'quote_accepted', 'deposit_verified', 'confirmed'];
  var BOOKED = A.BOOKED = ['confirmed', 'completed'];
  var BASE_FIELDS = ['status', 'follow_up_on', 'quote_amount', 'deposit_amount', 'deposit_received_on',
                'payment_reference', 'confirmation_exception', 'closed_reason', 'event_date', 'guest_count', 'venue_address'];
  // available after the booking database update (0005)
  var OPS_FIELDS = ['event_start_time', 'event_end_time', 'deposit_due_on', 'balance_amount', 'balance_due_on',
                    'balance_received_on', 'balance_reference'];
  function fields() { return BASE_FIELDS.concat(A.ops && A.ops.ready ? OPS_FIELDS : []); }

  var B = A.bookings = { rows: [] };
  var current = null;

  A.sourceOf = function (r) {
    if (r.heard_about) return r.heard_about;
    if (r.utm_source) return r.utm_source;
    if (r.referrer) { try { return new URL(r.referrer).hostname.replace(/^www\./, ''); } catch (e) {} }
    return 'Not given';
  };

  B.load = function () {
    return A.db.from('inquiries').select('*').order('created_at', { ascending: false }).then(function (res) {
      if (res.error) { A.toast('Could not load inquiries: ' + res.error.message, true); return; }
      B.rows = res.data || [];
      fillSources();
      render();
      if (current) B.reopen(true);
      if (A.reports) A.reports.render();
      if (A.ops) A.ops.changed();
    });
  };

  function fillSources() {
    var sel = $('f-source'), keep = sel.value;
    var sources = {};
    B.rows.forEach(function (r) { sources[A.sourceOf(r)] = true; });
    sel.textContent = '';
    sel.appendChild(el('option', 'All sources')).value = '';
    Object.keys(sources).sort().forEach(function (s) { var o = el('option', s); o.value = s; sel.appendChild(o); });
    sel.value = keep;
  }

  function visible() {
    var st = $('f-status').value, tests = $('f-tests').checked, q = $('f-search').value.trim().toLowerCase();
    var src = $('f-source').value, type = $('f-type').value, from = $('f-from').value, to = $('f-to').value;
    return B.rows.filter(function (r) {
      if (!tests && r.is_test) return false;
      if (st === 'active' && ACTIVE.indexOf(r.status) === -1) return false;
      if (st !== 'active' && st !== 'all' && r.status !== st) return false;
      if (src && A.sourceOf(r) !== src) return false;
      if (type && r.inquiry_type !== type) return false;
      if (from && (!r.event_date || r.event_date < from)) return false;
      if (to && (!r.event_date || r.event_date > to)) return false;
      if (q) {
        var hay = [r.name, r.email, r.phone, r.venue_address, r.city_neighborhood, r.event_type, r.message].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function render() {
    var tests = $('f-tests').checked;
    var base = B.rows.filter(function (r) { return tests || !r.is_test; });
    var t = A.today();
    $('s-new').textContent = base.filter(function (r) { return r.status === 'new'; }).length;
    $('s-open').textContent = base.filter(function (r) { return ['contacted', 'quoted', 'quote_accepted', 'deposit_verified'].indexOf(r.status) !== -1; }).length;
    $('s-confirmed').textContent = base.filter(function (r) { return r.status === 'confirmed'; }).length;
    $('s-overdue').textContent = base.filter(function (r) { return r.follow_up_on && r.follow_up_on <= t && ACTIVE.indexOf(r.status) !== -1; }).length;
    var booked = base.filter(function (r) { return BOOKED.indexOf(r.status) !== -1; }).length;
    $('s-rate').textContent = base.length ? Math.round(100 * booked / base.length) + '%' : '–';

    var tbody = $('list').querySelector('tbody');
    tbody.textContent = '';
    var list = visible();
    if (!list.length) {
      var tr0 = el('tr'); var td0 = el('td', 'No inquiries match this view.', 'empty'); td0.colSpan = 7; tr0.appendChild(td0); tbody.appendChild(tr0);
    }
    list.forEach(function (r) {
      var tr = el('tr');
      tr.tabIndex = 0;
      if (current && current.id === r.id) tr.className = 'selected';
      [A.fmtDate(r.created_at), r.name + (r.is_test ? ' (test)' : ''), r.event_type || '—', A.fmtDate(r.event_date), r.guest_count || '—']
        .forEach(function (v) { tr.appendChild(el('td', v)); });
      var stTd = el('td'); stTd.appendChild(el('span', STATUS_LABEL[r.status], 'pill ' + r.status)); tr.appendChild(stTd);
      var due = r.follow_up_on && r.follow_up_on <= t && ACTIVE.indexOf(r.status) !== -1;
      tr.appendChild(el('td', r.follow_up_on ? A.fmtDate(r.follow_up_on) + (due ? ' • due' : '') : '—', due ? 'due' : ''));
      tr.addEventListener('click', function () { open(r.id); });
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(r.id); });
      tbody.appendChild(tr);
    });
  }

  function open(id, quiet) {
    current = B.rows.filter(function (r) { return r.id === id; })[0];
    if (!current) return;
    var r = current;
    $('detail').hidden = false;
    $('d-name').textContent = r.name + (r.is_test ? ' (test inquiry)' : '');
    $('d-meta').textContent = (r.inquiry_type === 'coffee_cart' ? 'Coffee Cart' : 'Gathering') + ' inquiry received ' + A.fmtDateTime(r.created_at);
    var dl = $('d-fields'); dl.textContent = '';
    [['Email', r.email, 'mailto:' + r.email], ['Phone', r.phone, r.phone ? 'tel:' + r.phone.replace(/[^0-9+]/g, '') : null],
     ['Event type', r.event_type], ['Event date', r.event_date ? A.fmtDate(r.event_date) : null], ['Guests', r.guest_count],
     ['Service', r.service_duration], ['Area', r.city_neighborhood], ['Venue', r.venue_address],
     ['Message', r.message], ['Source', A.sourceOf(r)],
     ['Confirmed', r.confirmed_at ? A.fmtDateTime(r.confirmed_at) + (r.confirmation_exception ? ' (approved exception)' : ' (deposit verified)') : null]
    ].forEach(function (f) {
      if (f[1] == null || f[1] === '') return;
      dl.appendChild(el('dt', f[0]));
      var dd = el('dd');
      if (f[2]) { var a = el('a', String(f[1])); a.href = f[2]; dd.appendChild(a); } else { dd.textContent = String(f[1]); }
      dl.appendChild(dd);
    });
    if (r.event_date) {
      var clash = B.rows.filter(function (o) { return o.id !== r.id && o.event_date === r.event_date && BOOKED.indexOf(o.status) !== -1 && !o.is_test; });
      if (clash.length) { dl.appendChild(el('dt', 'Heads up')); dl.appendChild(el('dd', clash.length + ' confirmed booking(s) already on this date.', 'due')); }
    }
    var f = $('d-form');
    fields().forEach(function (k) {
      var v = r[k] == null ? '' : String(r[k]);
      if (/_time$/.test(k)) v = v.slice(0, 5);
      f.elements[k].value = v;
    });
    if (A.bookingDetailExtras) A.bookingDetailExtras(r);
    if (!quiet) $('d-msg').textContent = '';
    loadNotes();
    render();
    if (!quiet) $('detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  B.open = open;
  B.currentId = function () { return current && current.id; };
  B.reopen = function (quiet) { if (current) open(current.id, quiet); };

  $('close-detail').addEventListener('click', function () { current = null; $('detail').hidden = true; render(); });

  $('d-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!current) return;
    var f = e.target, patch = {};
    fields().forEach(function (k) { var v = f.elements[k].value.trim(); patch[k] = v === '' ? null : v; });
    var prev = current.status;
    if (patch.status === 'confirmed' && prev !== 'confirmed') {
      $('d-msg').textContent = 'To confirm, use “Confirm & Send” at the top of this booking: it checks the accepted quote, the verified deposit and the calendar, then emails the customer.';
      return;
    }
    if (patch.status === 'quote_accepted' && prev !== 'quote_accepted') {
      $('d-msg').textContent = 'Record acceptance with “Mark accepted” on the quote (or “Record customer response”), so the date and how they accepted are kept.';
      return;
    }
    if (patch.status === 'deposit_verified' && !(Number(patch.deposit_amount) > 0 && patch.deposit_received_on && patch.payment_reference)) {
      $('d-msg').textContent = 'Deposit verified needs the deposit amount, the date received and the payment reference — check your bank or payment app first.';
      return;
    }
    if (BOOKED.indexOf(patch.status) !== -1 && !patch.confirmation_exception &&
        !(Number(patch.deposit_amount) > 0 && patch.deposit_received_on && patch.payment_reference)) {
      $('d-msg').textContent = 'To confirm, record the deposit amount, date received and payment reference — or write an approved exception.';
      return;
    }
    if ((patch.status === 'declined' || patch.status === 'lost') && !patch.closed_reason) {
      $('d-msg').textContent = 'Add a short reason so reporting stays useful.';
      return;
    }
    $('d-msg').textContent = 'Saving…';
    A.db.from('inquiries').update(patch).eq('id', current.id).select().then(function (res) {
      if (res.error || !res.data || !res.data.length) { $('d-msg').textContent = 'Not saved: ' + (res.error ? res.error.message : 'no permission'); return; }
      var updated = res.data[0];
      B.rows = B.rows.map(function (r) { return r.id === updated.id ? updated : r; });
      current = updated;
      $('d-msg').textContent = 'Saved.';
      render();
      if (A.bookingDetailExtras) A.bookingDetailExtras(updated);
      if (A.reports) A.reports.render();
      if (A.ops) A.ops.changed();
    });
  });

  var notesSeq = 0;
  function loadNotes() {
    var ol = $('d-notes'), mine = ++notesSeq;
    A.db.from('inquiry_notes').select('*').eq('inquiry_id', current.id).order('created_at').then(function (res) {
      if (mine !== notesSeq) return;   // a newer refresh is already showing the notes
      ol.textContent = '';
      if (res.error) { ol.appendChild(el('li', 'Could not load notes.')); return; }
      if (!res.data.length) ol.appendChild(el('li', 'No notes yet.', 'muted'));
      res.data.forEach(function (n) {
        var li = el('li'); li.appendChild(el('span', A.fmtDateTime(n.created_at), 'muted')); li.appendChild(el('p', n.body)); ol.appendChild(li);
      });
    });
  }

  $('note-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var body = $('note-body').value.trim();
    if (!body || !current) return;
    A.db.from('inquiry_notes').insert({ inquiry_id: current.id, body: body }).then(function (res) {
      if (res.error) { A.toast('Note not saved: ' + res.error.message, true); return; }
      $('note-body').value = '';
      loadNotes();
    });
  });

  $('export').addEventListener('click', function () {
    Promise.all([
      A.db.from('inquiries').select('*').order('created_at'),
      A.db.from('inquiry_notes').select('*').order('created_at')
    ]).then(function (res) {
      if (res[0].error || res[1].error) { A.toast('Export failed.', true); return; }
      A.download('raaha-inquiries-' + A.today() + '.csv', A.csv(res[0].data));
      A.download('raaha-inquiry-notes-' + A.today() + '.csv', A.csv(res[1].data));
    });
  });

  ['f-status', 'f-tests', 'f-source', 'f-type', 'f-from', 'f-to'].forEach(function (id) { $(id).addEventListener('change', render); });
  $('f-search').addEventListener('input', render);
  $('refresh').addEventListener('click', B.load);

  A.modules.push({ tab: 'bookings', start: B.load });
})();
