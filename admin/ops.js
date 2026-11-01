/* RAAHA admin — Operations data shared by the booking dashboard, calendar, quotes and booking detail.
   Quotes, event times, payment due dates and blocked days need the booking database update (0005).
   Until it is applied, A.ops.ready is false and those parts stay hidden; everything else keeps working.
   Nothing here charges money, sends email, accepts a quote or confirms a booking by itself. */
(function () {
  'use strict';
  var A = window.RAAHA_ADMIN, $ = A.$, el = A.el, db = A.db;
  var O = A.ops = { ready: false, quotes: [], blocks: [] };

  // ---------- readiness: is the booking database update in place? ----------
  O.load = function () {
    return Promise.all([
      db.from('booking_quotes').select('*').order('created_at', { ascending: false }),
      db.from('calendar_blocks').select('*').order('starts_on')
    ]).then(function (res) {
      O.ready = !res[0].error && !res[1].error;
      O.quotes = O.ready ? res[0].data || [] : [];
      O.blocks = O.ready ? res[1].data || [] : [];
      document.body.classList.toggle('ops-ready', O.ready);
      document.querySelectorAll('.ops-wait').forEach(function (p) { p.hidden = O.ready; });
      document.querySelectorAll('.ops-only').forEach(function (p) { p.hidden = !O.ready; });
    });
  };
  O.refresh = function () {
    return Promise.all([A.bookings.load(), O.load()]).then(function () { O.changed(); });
  };
  // screens re-render when bookings or quotes change
  var listeners = [];
  O.onChange = function (fn) { listeners.push(fn); };
  O.changed = function () { listeners.forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } }); };

  // ---------- statuses ----------
  // Calendar meaning of each booking status. Declined / lost are not shown.
  O.calStatus = function (r) {
    if (r.status === 'confirmed' || r.status === 'completed') return 'confirmed';
    if (r.status === 'quoted') return 'tentative';
    if (r.status === 'new' || r.status === 'contacted') return 'inquiry';
    return null;
  };
  O.CAL_LABEL = { inquiry: 'Inquiry', tentative: 'Tentative', confirmed: 'Confirmed' };
  O.QUOTE_LABEL = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted', declined: 'Declined', expired: 'Expired', superseded: 'Replaced' };
  // RAAHA-2026-001, assigned by the database; revisions keep the number
  O.quoteNo = function (q) { return (q.quote_number || 'Quote') + (q.version > 1 ? ' · rev. ' + q.version : ''); };
  O.quotesFor = function (inquiryId) {
    return O.quotes.filter(function (q) { return q.inquiry_id === inquiryId; }).sort(function (a, b) { return b.version - a.version; });
  };
  O.acceptedQuote = function (inquiryId) { return O.quotesFor(inquiryId).filter(function (q) { return q.status === 'accepted'; })[0] || null; };
  O.pastValid = function (q) { return q.status === 'sent' && q.valid_until && q.valid_until < A.today(); };

  // ---------- payments (manual) ----------
  function n(v) { return v == null || v === '' ? null : Number(v); }
  O.payment = function (r) {
    var t = A.today(), dep = n(r.deposit_amount), bal = n(r.balance_amount);
    if (!dep && bal == null) return { key: 'none', label: 'No payment terms recorded' };
    if (dep && !r.deposit_received_on) {
      var od = r.deposit_due_on && r.deposit_due_on < t;
      return { key: od ? 'overdue' : 'deposit', due: r.deposit_due_on, overdue: od,
        label: (od ? 'Deposit overdue' : 'Deposit due') + ' — ' + A.money(dep) + (r.deposit_due_on ? ' by ' + A.fmtDate(r.deposit_due_on) : '') };
    }
    if (bal && !r.balance_received_on) {
      var ob = r.balance_due_on && r.balance_due_on < t;
      return { key: ob ? 'overdue' : 'balance', due: r.balance_due_on, overdue: ob,
        label: (dep ? 'Deposit received · ' : '') + (ob ? 'Balance overdue' : 'Balance due') + ' — ' + A.money(bal) + (r.balance_due_on ? ' by ' + A.fmtDate(r.balance_due_on) : '') };
    }
    return { key: 'paid', label: bal || r.balance_received_on ? 'Paid in full' : 'Deposit received' + (bal === 0 ? ' · no balance' : '') };
  };
  // Remaining balance from the amounts you entered: accepted quote (or recorded quote) minus the deposit
  O.suggestBalance = function (r) {
    var q = O.acceptedQuote(r.id), total = q ? Number(q.total) : n(r.quote_amount), dep = n(r.deposit_amount) || 0;
    if (total == null) return null;
    return { amount: Math.max(0, Math.round((total - dep) * 100) / 100), from: q ? 'accepted quote ' + O.quoteNo(q) : 'recorded quote' };
  };

  // ---------- conflicts: overlapping confirmed events, or a confirmed event on a blocked day ----------
  function mins(t) { if (!t) return null; var p = String(t).split(':'); return Number(p[0]) * 60 + Number(p[1] || 0); }
  O.blockOn = function (date) { return O.blocks.filter(function (b) { return b.starts_on <= date && b.ends_on >= date; }); };
  O.conflicts = function (rows) {
    var out = {}, conf = rows.filter(function (r) { return r.event_date && O.calStatus(r) === 'confirmed' && r.status !== 'completed'; });
    function add(id, msg) { (out[id] = out[id] || []).push(msg); }
    conf.forEach(function (a, i) {
      conf.slice(i + 1).forEach(function (b) {
        if (a.event_date !== b.event_date) return;
        var as = mins(a.event_start_time), ae = mins(a.event_end_time), bs = mins(b.event_start_time), be = mins(b.event_end_time);
        var known = as != null && ae != null && bs != null && be != null;
        if (known && !(as < be && bs < ae)) return;
        var why = known ? 'overlaps' : 'is on the same day (times not set)';
        add(a.id, 'Confirmed event ' + why + ' with ' + b.name);
        add(b.id, 'Confirmed event ' + why + ' with ' + a.name);
      });
      O.blockOn(a.event_date).forEach(function (bl) { add(a.id, 'Date is marked unavailable: ' + bl.label); });
    });
    return out;
  };
  O.timeRange = function (r) {
    function f(t) {
      if (!t) return ''; var m = mins(t), h = Math.floor(m / 60), mm = m % 60;
      return ((h % 12) || 12) + (mm ? ':' + String(mm).padStart(2, '0') : '') + (h < 12 ? 'am' : 'pm');
    }
    return r.event_start_time ? f(r.event_start_time) + (r.event_end_time ? '–' + f(r.event_end_time) : '') : '';
  };
  O.place = function (r) { return r.venue_address || r.city_neighborhood || ''; };

  // ---------- open a booking from any screen ----------
  A.openBooking = function (id) {
    A.showTab('bookings');
    var r = A.bookings.rows.filter(function (x) { return x.id === id; })[0];
    if (r && r.is_test && !$('f-tests').checked) { $('f-tests').checked = true; }
    if (r && $('f-status').value !== 'all') $('f-status').value = 'all';
    A.bookings.open(id);
  };

  // ---------- booking detail: payment status, balance hint and quotes ----------
  A.bookingDetailExtras = function (r) {
    document.querySelectorAll('#d-quotes-box .conflict-note').forEach(function (x) { x.remove(); });
    if (!O.ready) return;
    var ps = O.payment(r), p = $('d-pay-status');
    p.textContent = ps.label; p.className = 'pay-status ' + ps.key;
    var hint = $('d-balance-hint'), sb = O.suggestBalance(r);
    hint.textContent = '';
    if (sb) {
      hint.appendChild(document.createTextNode('From the ' + sb.from + ' minus the deposit: ' + A.money(sb.amount) + '. '));
      var use = el('button', 'Use this amount', 'link'); use.type = 'button';
      use.addEventListener('click', function () { $('d-form').elements.balance_amount.value = sb.amount.toFixed(2); A.toast('Balance filled in — click Save changes to record it.'); });
      hint.appendChild(use);
    }
    var box = $('d-quotes'); box.textContent = '';
    var qs = O.quotesFor(r.id);
    if (!qs.length) box.appendChild(el('p', 'No quotes yet.', 'muted'));
    qs.forEach(function (q) {
      var row = el('div', null, 'q-row');
      var b = el('button', O.quoteNo(q) + ' · ' + A.money(q.total), 'link'); b.type = 'button';
      b.addEventListener('click', function () { A.quoteEditor.open(q.id); });
      row.appendChild(b);
      row.appendChild(el('span', O.QUOTE_LABEL[q.status] + (O.pastValid(q) ? ' · past valid date' : ''), 'pill q-' + q.status));
      if (q.sent_on) row.appendChild(el('span', 'sent ' + A.fmtDate(q.sent_on), 'muted small'));
      box.appendChild(row);
    });
    var conf = O.conflicts(A.bookings.rows.filter(function (x) { return !x.is_test || r.is_test; }))[r.id];
    if (conf) box.parentNode.insertBefore(el('p', '⚠ ' + conf.join(' · '), 'conflict-note'), box);
  };
  $('d-new-quote').addEventListener('click', function () {
    var id = A.bookings.currentId();
    if (id) A.quoteEditor.create(id);
  });

  // ---------- module: load with the rest of the Admin ----------
  A.modules.push({ tab: '_ops', start: function () { return O.load(); } });
})();
