/* RAAHA admin — Reports. Uses recorded inquiries only. "Confirmed value" sums the quote on
   bookings that are confirmed or completed; unconfirmed inquiries are never counted as revenue. */
(function () {
  'use strict';
  var A = window.RAAHA_ADMIN, $ = A.$, el = A.el;
  var R = A.reports = {};

  function rows() {
    var tests = $('r-tests').checked;
    return A.bookings.rows.filter(function (r) { return tests || !r.is_test; });
  }
  function pct(a, b) { return b ? Math.round(100 * a / b) + '%' : '–'; }
  function fill(id, data, cols) {
    var tb = $(id).querySelector('tbody'); tb.textContent = '';
    if (!data.length) { var tr = el('tr'); var td = el('td', 'No inquiries recorded yet.', 'empty'); td.colSpan = cols; tr.appendChild(td); tb.appendChild(tr); return; }
    data.forEach(function (row) { var tr = el('tr'); row.forEach(function (v) { tr.appendChild(el('td', v)); }); tb.appendChild(tr); });
  }

  R.render = function () {
    var list = rows();
    var booked = list.filter(function (r) { return A.BOOKED.indexOf(r.status) !== -1; });
    var value = booked.reduce(function (s, r) { return s + Number(r.quote_amount || 0); }, 0);
    var missingQuote = booked.filter(function (r) { return r.quote_amount == null; }).length;
    var sum = $('r-summary'); sum.textContent = '';
    [[list.length, 'Inquiries'], [booked.length, 'Confirmed / completed'], [pct(booked.length, list.length), 'Conversion'],
     [A.money(value), 'Confirmed booking value' + (missingQuote ? ' (' + missingQuote + ' without a quote)' : '')]]
      .forEach(function (s) { var d = el('div', null, 'stat'); d.appendChild(el('span', String(s[0]))); d.appendChild(document.createTextNode(s[1])); sum.appendChild(d); });

    var byMonth = {}, bySource = {}, byStatus = {};
    list.forEach(function (r) {
      var m = r.created_at.slice(0, 7), s = A.sourceOf(r), b = A.BOOKED.indexOf(r.status) !== -1;
      byMonth[m] = byMonth[m] || [0, 0, 0]; byMonth[m][0]++; if (b) { byMonth[m][1]++; byMonth[m][2] += Number(r.quote_amount || 0); }
      bySource[s] = bySource[s] || [0, 0]; bySource[s][0]++; if (b) bySource[s][1]++;
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    });
    R.monthRows = Object.keys(byMonth).sort().reverse().map(function (k) {
      var label = new Date(k + '-15T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      return [label, byMonth[k][0], byMonth[k][1], pct(byMonth[k][1], byMonth[k][0]), A.money(byMonth[k][2])];
    });
    R.sourceRows = Object.keys(bySource).sort(function (a, b) { return bySource[b][0] - bySource[a][0]; })
      .map(function (k) { return [k, bySource[k][0], bySource[k][1], pct(bySource[k][1], bySource[k][0])]; });
    R.statusRows = Object.keys(A.STATUS_LABEL).filter(function (k) { return byStatus[k]; })
      .map(function (k) { return [A.STATUS_LABEL[k], byStatus[k]]; });
    fill('r-month', R.monthRows, 5);
    fill('r-source', R.sourceRows, 4);
    fill('r-status', R.statusRows, 2);
  };

  $('r-tests').addEventListener('change', R.render);
  $('r-export').addEventListener('click', function () {
    R.render();
    var out = [];
    R.monthRows.forEach(function (r) { out.push({ report: 'month', label: r[0], inquiries: r[1], confirmed: r[2], conversion: r[3], confirmed_value: r[4] }); });
    R.sourceRows.forEach(function (r) { out.push({ report: 'source', label: r[0], inquiries: r[1], confirmed: r[2], conversion: r[3], confirmed_value: '' }); });
    R.statusRows.forEach(function (r) { out.push({ report: 'status', label: r[0], inquiries: r[1], confirmed: '', conversion: '', confirmed_value: '' }); });
    if (!out.length) { A.toast('No inquiries to report yet.'); return; }
    A.download('raaha-report-' + A.today() + '.csv', A.csv(out));
  });
  A.modules.push({ tab: 'reports', onShow: R.render });
})();
