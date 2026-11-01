/* RAAHA admin — Booking calendar (month and week). Shows bookings by event date:
   Inquiry (received / contacted), Tentative (quote provided), Confirmed (confirmed / completed).
   Declined and lost inquiries are not shown. Overlapping confirmed events and confirmed events on
   unavailable days are flagged. Unavailable dates are private and never shown on the website. */
(function () {
  'use strict';
  var A = window.RAAHA_ADMIN, $ = A.$, el = A.el, db = A.db, O = A.ops;
  var mode = 'month', cursor = A.today();
  try { mode = sessionStorage.getItem('raaha-cal-mode') || 'month'; } catch (e) {}

  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function parse(s) { var p = s.split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
  function startOfWeek(s) { var d = parse(s); d.setDate(d.getDate() - d.getDay()); return iso(d); }
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function rows() {
    var tests = $('cal-tests').checked;
    return A.bookings.rows.filter(function (r) { return r.event_date && O.calStatus(r) && (tests || !r.is_test); });
  }
  function sortByTime(a, b) { return String(a.event_start_time || '99').localeCompare(String(b.event_start_time || '99')) || a.name.localeCompare(b.name); }

  function chip(r, conflicts, full) {
    var st = O.calStatus(r);
    var b = el('button', null, 'ev ' + st + (conflicts[r.id] ? ' conflict' : '')); b.type = 'button';
    var t = O.timeRange(r);
    b.appendChild(el('span', (t ? t + ' ' : '') + r.name + (r.is_test ? ' (test)' : ''), 'ev-name'));
    if (full) {
      var meta = [O.CAL_LABEL[st], r.event_type, O.place(r), r.guest_count ? r.guest_count + ' guests' : ''].filter(Boolean).join(' · ');
      b.appendChild(el('span', meta, 'ev-meta'));
      if (conflicts[r.id]) b.appendChild(el('span', '⚠ ' + conflicts[r.id].join(' · '), 'ev-warn'));
    }
    b.title = [O.CAL_LABEL[st], r.name, t, O.place(r)].concat(conflicts[r.id] || []).filter(Boolean).join(' — ');
    b.addEventListener('click', function () { A.openBooking(r.id); });
    return b;
  }

  function render() {
    document.querySelectorAll('.cal-modes [data-mode]').forEach(function (b) { b.classList.toggle('is-on', b.dataset.mode === mode); b.setAttribute('aria-pressed', b.dataset.mode === mode); });
    var list = rows(), conflicts = O.conflicts(list), t = A.today();
    var byDate = {}; list.forEach(function (r) { (byDate[r.event_date] = byDate[r.event_date] || []).push(r); });
    var grid = $('cal-grid'); grid.textContent = '';
    var first, days, d0 = parse(cursor);
    if (mode === 'month') {
      first = startOfWeek(iso(new Date(d0.getFullYear(), d0.getMonth(), 1, 12)));
      var last = new Date(d0.getFullYear(), d0.getMonth() + 1, 0, 12);
      days = Math.ceil((((parse(iso(last)) - parse(first)) / 864e5) + 1) / 7) * 7;
      $('cal-title').textContent = d0.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    } else {
      first = startOfWeek(cursor); days = 7;
      var end = addDays(first, 6);
      $('cal-title').textContent = 'Week of ' + A.fmtDate(first) + ' – ' + A.fmtDate(end);
    }
    var wrap = el('div', null, 'cal ' + mode);
    if (mode === 'month') DOW.forEach(function (d) { wrap.appendChild(el('div', d, 'cal-dow')); });
    for (var i = 0; i < days; i++) {
      var day = addDays(first, i), dd = parse(day);
      var cell = el('div', null, 'cal-day');
      if (mode === 'month' && dd.getMonth() !== d0.getMonth()) cell.classList.add('other');
      if (day === t) cell.classList.add('today');
      if (day < t) cell.classList.add('past');
      var blocks = O.blockOn(day);
      if (blocks.length) { cell.classList.add('blocked'); }
      var evs = (byDate[day] || []).slice().sort(sortByTime);
      if (!evs.length && !blocks.length) cell.classList.add('empty');
      var head = el('div', null, 'cal-date');
      head.appendChild(el('span', mode === 'week' ? DOW[dd.getDay()] + ' ' + dd.getDate() : String(dd.getDate())));
      head.appendChild(el('span', dd.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }), 'cal-date-long'));
      cell.appendChild(head);
      blocks.forEach(function (b) { cell.appendChild(el('div', 'Unavailable — ' + b.label, 'blk')); });
      evs.forEach(function (r) { cell.appendChild(chip(r, conflicts, mode === 'week')); });
      wrap.appendChild(cell);
    }
    grid.appendChild(wrap);
    // warnings for the visible range
    var lastDay = addDays(first, days - 1);
    var warn = list.filter(function (r) { return conflicts[r.id] && r.event_date >= first && r.event_date <= lastDay; });
    var w = $('cal-warn'); w.textContent = ''; w.hidden = !warn.length;
    if (warn.length) {
      w.appendChild(el('strong', 'Check these dates: '));
      warn.forEach(function (r, i) {
        var a = el('button', A.fmtDate(r.event_date) + ' · ' + r.name, 'link'); a.type = 'button';
        a.addEventListener('click', function () { A.openBooking(r.id); });
        if (i) w.appendChild(document.createTextNode(' · '));
        w.appendChild(a); w.appendChild(document.createTextNode(' (' + conflicts[r.id].join('; ') + ')'));
      });
    }
    renderBlocks();
  }

  $('cal-prev').addEventListener('click', function () { move(-1); });
  $('cal-next').addEventListener('click', function () { move(1); });
  $('cal-today').addEventListener('click', function () { cursor = A.today(); render(); });
  function move(dir) {
    if (mode === 'week') cursor = addDays(cursor, 7 * dir);
    else { var d = parse(cursor); cursor = iso(new Date(d.getFullYear(), d.getMonth() + dir, 1, 12)); }
    render();
  }
  document.querySelectorAll('.cal-modes [data-mode]').forEach(function (b) {
    b.addEventListener('click', function () { mode = b.dataset.mode; try { sessionStorage.setItem('raaha-cal-mode', mode); } catch (e) {} render(); });
  });
  $('cal-tests').addEventListener('change', render);

  // ---------- unavailable dates ----------
  function renderBlocks() {
    if (!O.ready) return;
    var ul = $('blk-list'); ul.textContent = '';
    var t = A.today(), up = O.blocks.filter(function (b) { return b.ends_on >= t; });
    if (!up.length) ul.appendChild(el('li', 'No upcoming unavailable dates.', 'muted'));
    up.forEach(function (b) {
      var li = el('li');
      li.appendChild(el('span', A.fmtDate(b.starts_on) + (b.ends_on !== b.starts_on ? ' – ' + A.fmtDate(b.ends_on) : '') + ' · ' + b.label));
      var rm = el('button', 'Remove', 'link'); rm.type = 'button';
      rm.addEventListener('click', function () {
        if (!confirm('Make ' + A.fmtDate(b.starts_on) + (b.ends_on !== b.starts_on ? ' – ' + A.fmtDate(b.ends_on) : '') + ' available again?')) return;
        db.from('calendar_blocks').delete().eq('id', b.id).then(function (res) {
          if (res.error) { A.toast('Not removed: ' + res.error.message, true); return; }
          O.blocks = O.blocks.filter(function (x) { return x.id !== b.id; }); O.changed(); A.toast('Dates available again.');
        });
      });
      li.appendChild(rm); ul.appendChild(li);
    });
  }
  $('blk-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var from = $('blk-from').value, to = $('blk-to').value || from, label = $('blk-label').value.trim();
    if (!from || !label) return;
    if (to < from) { A.toast('The end date is before the start date.', true); return; }
    var clash = A.bookings.rows.filter(function (r) { return !r.is_test && r.event_date >= from && r.event_date <= to && O.calStatus(r) === 'confirmed'; });
    if (clash.length && !confirm(clash.length + ' confirmed booking(s) fall on these dates (' + clash.map(function (r) { return r.name; }).join(', ') + '). Block them anyway?')) return;
    db.from('calendar_blocks').insert({ starts_on: from, ends_on: to, label: label }).select().then(function (res) {
      if (res.error) { A.toast('Not blocked: ' + res.error.message, true); return; }
      O.blocks.push(res.data[0]); O.blocks.sort(function (a, b) { return a.starts_on.localeCompare(b.starts_on); });
      $('blk-form').reset(); O.changed(); A.toast('Dates marked unavailable.');
    });
  });

  O.onChange(function () { if (!$('tab-calendar').hidden) render(); });
  A.modules.push({ tab: 'calendar', onShow: render });
})();
