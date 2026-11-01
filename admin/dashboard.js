/* RAAHA admin — Booking dashboard: what needs attention, at a glance.
   Counts come from recorded inquiries and quotes only; nothing is estimated or projected. */
(function () {
  'use strict';
  var A = window.RAAHA_ADMIN, $ = A.$, el = A.el, O = A.ops;
  var ACTIVE = ['new', 'contacted', 'quoted', 'confirmed'];

  function card(title, items, emptyText, render, note) {
    var c = el('section', null, 'dash-card');
    var h = el('h2'); h.appendChild(el('span', String(items.length), 'dash-n')); h.appendChild(document.createTextNode(' ' + title)); c.appendChild(h);
    if (note) c.appendChild(el('p', note, 'muted small'));
    var ul = el('ul', null, 'dash-list');
    if (!items.length) ul.appendChild(el('li', emptyText, 'muted'));
    items.slice(0, 6).forEach(function (it) { ul.appendChild(render(it)); });
    c.appendChild(ul);
    if (items.length > 6) c.appendChild(el('p', '+ ' + (items.length - 6) + ' more', 'muted small'));
    return c;
  }
  function bookingItem(r, extra, cls) {
    var li = el('li'); var b = el('button', null, 'dash-item' + (cls ? ' ' + cls : '')); b.type = 'button';
    b.appendChild(el('strong', r.name + (r.is_test ? ' (test)' : '')));
    b.appendChild(el('span', extra, 'muted small'));
    b.addEventListener('click', function () { A.openBooking(r.id); });
    li.appendChild(b); return li;
  }
  function inq(id) { return A.bookings.rows.filter(function (r) { return r.id === id; })[0] || {}; }

  function render() {
    var tests = $('o-tests').checked, t = A.today();
    function plus(n) { var d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    var horizon = plus(30), soonIso = plus(7);
    var rows = A.bookings.rows.filter(function (r) { return tests || !r.is_test; });
    var conflicts = O.conflicts(rows);
    var box = $('dash'); box.textContent = '';

    var fresh = rows.filter(function (r) { return r.status === 'new'; })
      .sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
    box.appendChild(card('New inquiries', fresh, 'No new inquiries.', function (r) {
      return bookingItem(r, 'Received ' + A.fmtDate(r.created_at) + (r.event_date ? ' · event ' + A.fmtDate(r.event_date) : '') + (r.guest_count ? ' · ' + r.guest_count + ' guests' : ''));
    }));

    var pending;
    if (O.ready) {
      pending = O.quotes.filter(function (q) { var r = inq(q.inquiry_id); return (q.status === 'sent' || q.status === 'draft') && r.id && (tests || !r.is_test); })
        .sort(function (a, b) { return (a.sent_on || '9') < (b.sent_on || '9') ? -1 : 1; });
      box.appendChild(card('Quotes pending', pending, 'No open quotes.', function (q) {
        var r = inq(q.inquiry_id), li = el('li'), b = el('button', null, 'dash-item' + (O.pastValid(q) ? ' warn' : '')); b.type = 'button';
        b.appendChild(el('strong', r.name + ' · ' + O.quoteNo(q) + ' · ' + A.money(q.total)));
        b.appendChild(el('span', q.status === 'sent' ? 'Sent ' + A.fmtDate(q.sent_on) + (q.valid_until ? ' · valid until ' + A.fmtDate(q.valid_until) : '') + (O.pastValid(q) ? ' · past valid date' : '') : 'Draft — not sent yet', 'muted small'));
        b.addEventListener('click', function () { A.quoteEditor.open(q.id); });
        li.appendChild(b); return li;
      }, 'Drafts and quotes sent but not yet answered.'));
    } else {
      pending = rows.filter(function (r) { return r.status === 'quoted'; });
      box.appendChild(card('Quotes pending', pending, 'No quotes waiting.', function (r) {
        return bookingItem(r, 'Quote provided' + (r.quote_amount != null ? ' · ' + A.money(r.quote_amount) : ''));
      }, 'Bookings marked “Quote provided”.'));
    }

    var confirmed = rows.filter(function (r) { return r.status === 'confirmed' && (!r.event_date || r.event_date >= t); })
      .sort(function (a, b) { return (a.event_date || '9') < (b.event_date || '9') ? -1 : 1; });
    box.appendChild(card('Confirmed bookings', confirmed, 'No upcoming confirmed bookings.', function (r) {
      return bookingItem(r, (r.event_date ? A.fmtDate(r.event_date) : 'No date') + (O.timeRange(r) ? ' · ' + O.timeRange(r) : '') + (O.ready ? ' · ' + O.payment(r).label : ''), conflicts[r.id] ? 'warn' : '');
    }));

    var upcoming = rows.filter(function (r) { var s = O.calStatus(r); return r.event_date && r.event_date >= t && r.event_date <= horizon && s && r.status !== 'completed'; })
      .sort(function (a, b) { return a.event_date < b.event_date ? -1 : a.event_date > b.event_date ? 1 : String(a.event_start_time || '').localeCompare(String(b.event_start_time || '')); });
    box.appendChild(card('Upcoming events (next 30 days)', upcoming, 'Nothing in the next 30 days.', function (r) {
      return bookingItem(r, A.fmtDate(r.event_date) + (O.timeRange(r) ? ' · ' + O.timeRange(r) : '') + ' · ' + O.CAL_LABEL[O.calStatus(r)] + (O.place(r) ? ' · ' + O.place(r) : '') +
        (conflicts[r.id] ? ' · ⚠ ' + conflicts[r.id][0] : ''), conflicts[r.id] ? 'warn' : '');
    }));

    var follow = rows.filter(function (r) { return r.follow_up_on && r.follow_up_on <= t && ACTIVE.indexOf(r.status) !== -1; })
      .sort(function (a, b) { return a.follow_up_on < b.follow_up_on ? -1 : 1; });
    box.appendChild(card('Follow-ups due', follow, 'No follow-ups due.', function (r) {
      return bookingItem(r, 'Due ' + A.fmtDate(r.follow_up_on) + ' · ' + A.STATUS_LABEL[r.status], r.follow_up_on < t ? 'warn' : '');
    }));

    if (O.ready) {
      var pay = rows.filter(function (r) {
        if (['declined', 'lost'].indexOf(r.status) !== -1) return false;
        var p = O.payment(r); return (p.key === 'deposit' || p.key === 'balance' || p.key === 'overdue') && (!p.due || p.due <= soonIso);
      }).sort(function (a, b) { return (O.payment(a).due || '0') < (O.payment(b).due || '0') ? -1 : 1; });
      box.appendChild(card('Payments due (next 7 days or overdue)', pay, 'No payments due.', function (r) {
        var p = O.payment(r); return bookingItem(r, p.label, p.overdue ? 'warn' : '');
      }, 'Recorded by hand on each booking. Nothing is charged online.'));
    }
  }

  $('o-tests').addEventListener('change', render);
  $('o-refresh').addEventListener('click', function () { O.refresh(); });
  O.onChange(function () { if (!$('tab-overview').hidden) render(); });
  A.modules.push({ tab: 'overview', onShow: render });
})();
