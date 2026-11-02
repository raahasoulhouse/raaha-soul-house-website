/* RAAHA admin — Booking dashboard: what needs attention, step by step.
   Counts come from recorded inquiries, quotes and emails only. TEST records are excluded unless shown. */
(function () {
  'use strict';
  var A = window.RAAHA_ADMIN, $ = A.$, el = A.el, O = A.ops;

  function card(title, items, emptyText, render, opts) {
    opts = opts || {};
    var c = el('section', null, 'dash-card' + (opts.alert && items.length ? ' alert' : '') + (items.length ? '' : ' empty'));
    var h = el('h2'); h.appendChild(el('span', String(items.length), 'dash-n')); h.appendChild(document.createTextNode(' ' + title)); c.appendChild(h);
    if (opts.note) c.appendChild(el('p', opts.note, 'muted small'));
    var ul = el('ul', null, 'dash-list');
    if (!items.length) ul.appendChild(el('li', emptyText, 'muted'));
    items.slice(0, 5).forEach(function (it) { ul.appendChild(render(it)); });
    c.appendChild(ul);
    if (items.length > 5) c.appendChild(el('p', '+ ' + (items.length - 5) + ' more', 'muted small'));
    return c;
  }
  function item(label, sub, onClick, warn) {
    var li = el('li'); var b = el('button', null, 'dash-item' + (warn ? ' warn' : '')); b.type = 'button';
    b.appendChild(el('strong', label)); b.appendChild(el('span', sub, 'muted small'));
    b.addEventListener('click', onClick); li.appendChild(b); return li;
  }
  function bk(r, sub, warn) { return item(r.name + (r.is_test ? ' (test)' : ''), sub, function () { A.openBooking(r.id); }, warn); }
  function qt(q, r, sub, warn) { return item((r.name || '') + ' · ' + O.quoteNo(q) + ' · ' + A.money(q.total), sub, function () { A.quoteEditor.open(q.id); }, warn); }
  function byId(rows) { var m = {}; rows.forEach(function (r) { m[r.id] = r; }); return m; }
  function asc(k) { return function (a, b) { return String(a[k] || '9') < String(b[k] || '9') ? -1 : 1; }; }

  function render() {
    var tests = $('o-tests').checked, t = A.today();
    var rows = A.bookings.rows.filter(function (r) { return tests || !r.is_test; });
    var ix = byId(rows), conflicts = O.conflicts(rows);
    var outgoing = {}; O.emails.forEach(function (e) { if ((e.kind === 'reply' || e.kind === 'quote') && e.status !== 'failed') outgoing[e.inquiry_id] = true; });
    var box = $('dash'); box.textContent = '';
    var add = function (c) { box.appendChild(c); };

    // 1. inquiries
    var fresh = rows.filter(function (r) { return r.status === 'new'; }).sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
    add(card('New inquiries', fresh, 'No new inquiries.', function (r) {
      return bk(r, 'Received ' + A.fmtDate(r.created_at) + (r.event_date ? ' · event ' + A.fmtDate(r.event_date) : '') + (r.guest_count ? ' · ' + r.guest_count + ' guests' : ''));
    }));
    var unanswered = fresh.filter(function (r) { return !outgoing[r.id]; });
    add(card('Unanswered', unanswered, 'Every new inquiry has a reply.', function (r) {
      var hrs = Math.round((Date.now() - new Date(r.created_at).getTime()) / 36e5);
      return bk(r, 'No reply or quote sent from Admin · waiting ' + (hrs < 48 ? hrs + ' h' : Math.round(hrs / 24) + ' days'), hrs >= 24);
    }, { alert: true, note: 'Replied from Gmail instead? Set the status to Contacted.' }));
    var follow = rows.filter(function (r) { return r.follow_up_on && r.follow_up_on <= t && A.ACTIVE.indexOf(r.status) !== -1; }).sort(asc('follow_up_on'));
    add(card('Follow-ups due', follow, 'No follow-ups due.', function (r) { return bk(r, 'Due ' + A.fmtDate(r.follow_up_on) + ' · ' + A.STATUS_LABEL[r.status], r.follow_up_on < t); }));

    if (O.ready) {
      // 2. quotes
      var mine = O.quotes.filter(function (q) { return ix[q.inquiry_id]; });
      var draft = mine.filter(function (q) { return q.status === 'draft' && !(Number(q.total) > 0); });
      var ready = mine.filter(function (q) { return q.status === 'draft' && Number(q.total) > 0; });
      var sent = mine.filter(function (q) { return q.status === 'sent'; }).sort(asc('sent_on'));
      add(card('Draft quotes', draft, 'No unfinished drafts.', function (q) { return qt(q, ix[q.inquiry_id], 'Draft — no prices yet'); }));
      add(card('Ready to approve & send', ready, 'Nothing waiting for approval.', function (q) { return qt(q, ix[q.inquiry_id], 'Priced draft — review, then Approve & Send'); }));
      add(card('Quotes sent — awaiting customer', sent, 'No quotes waiting for an answer.', function (q) {
        return qt(q, ix[q.inquiry_id], 'Sent ' + A.fmtDate(q.sent_on) + (q.valid_until ? ' · valid until ' + A.fmtDate(q.valid_until) : '') + (O.pastValid(q) ? ' · past valid date' : ''), O.pastValid(q));
      }));
      // 3. acceptance, deposit, confirmation
      var accepted = rows.filter(function (r) { return r.status === 'quote_accepted'; });
      add(card('Accepted — awaiting deposit', accepted, 'None.', function (r) {
        var p = O.payment(r); return bk(r, (r.event_date ? A.fmtDate(r.event_date) + ' · ' : '') + p.label, p.overdue);
      }));
      var verified = rows.filter(function (r) { return r.status === 'deposit_verified'; });
      add(card('Deposit verified — ready to Confirm & Send', verified, 'None.', function (r) {
        return bk(r, A.money(r.deposit_amount) + ' received ' + A.fmtDate(r.deposit_received_on) + ' · ref. ' + r.payment_reference);
      }, { alert: true }));
      var confirmed = rows.filter(function (r) { return r.status === 'confirmed' && (!r.event_date || r.event_date >= t); }).sort(asc('event_date'));
      add(card('Confirmed bookings', confirmed, 'No upcoming confirmed bookings.', function (r) {
        return bk(r, (r.event_date ? A.fmtDate(r.event_date) : 'No date') + (O.timeRange(r) ? ' · ' + O.timeRange(r) : '') + ' · ' + O.payment(r).label, !!conflicts[r.id]);
      }));
      var owing = rows.filter(function (r) { return (r.status === 'confirmed' || r.status === 'completed') && Number(r.balance_amount) > 0 && !r.balance_received_on; }).sort(asc('balance_due_on'));
      add(card('Outstanding balances', owing, 'No balances outstanding.', function (r) {
        var p = O.payment(r); return bk(r, p.label, p.overdue);
      }, { note: owing.length ? 'Total ' + A.money(owing.reduce(function (s, r) { return s + Number(r.balance_amount || 0); }, 0)) + ' · recorded by hand, nothing is charged online.' : '' }));
      // 4. email problems
      var bad = O.emails.filter(function (e) { return O.emailBad(e) && (!e.inquiry_id || ix[e.inquiry_id]); });
      add(card('Emails needing attention', bad, 'All emails were accepted for delivery.', function (e) {
        var r = ix[e.inquiry_id] || {};
        return item((r.name || e.to_email) + ' · ' + (O.EMAIL_KIND[e.kind] || e.kind), O.EMAIL_LABEL[e.status] + (e.error ? ' — ' + e.error : ''), function () { if (r.id) A.openBooking(r.id); }, true);
      }, { alert: true }));
    }
    // 5. calendar
    var upcoming = rows.filter(function (r) { return r.event_date && r.event_date >= t && O.calStatus(r) && r.status !== 'completed' && r.event_date <= plus(30); })
      .sort(function (a, b) { return a.event_date < b.event_date ? -1 : a.event_date > b.event_date ? 1 : String(a.event_start_time || '').localeCompare(String(b.event_start_time || '')); });
    add(card('Upcoming events (next 30 days)', upcoming, 'Nothing in the next 30 days.', function (r) {
      return bk(r, A.fmtDate(r.event_date) + (O.timeRange(r) ? ' · ' + O.timeRange(r) : '') + ' · ' + A.STATUS_LABEL[r.status] + (conflicts[r.id] ? ' · ⚠ ' + conflicts[r.id][0] : ''), !!conflicts[r.id]);
    }));
  }
  function plus(n) { var d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  $('o-tests').addEventListener('change', render);
  $('o-refresh').addEventListener('click', function () { O.refresh(); });
  O.onChange(function () { if (!$('tab-overview').hidden) render(); });
  A.modules.push({ tab: 'overview', onShow: render });
})();
