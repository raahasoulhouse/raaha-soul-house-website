/* RAAHA admin — Custom quotes. Every line, quantity and price is typed by an admin; there are no
   packages, templates or pre-filled prices. The database computes the total from the typed lines.
   A quote becomes "accepted" only when an admin clicks Mark accepted, and that never confirms a booking:
   confirming still requires the recorded deposit (or a written exception) on the booking. */
(function () {
  'use strict';
  var A = window.RAAHA_ADMIN, $ = A.$, el = A.el, db = A.db, O = A.ops;

  function num(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function r2(x) { return Math.round(x * 100) / 100; }
  function inquiry(id) { return A.bookings.rows.filter(function (r) { return r.id === id; })[0] || null; }

  // ---------- quotes list ----------
  function renderList() {
    if (!O.ready) return;
    var st = $('q-status').value, tests = $('q-tests').checked;
    var tb = $('q-list').querySelector('tbody'); tb.textContent = '';
    var list = O.quotes.filter(function (q) {
      var r = inquiry(q.inquiry_id);
      if (r && r.is_test && !tests) return false;
      if (st === 'open') return q.status === 'draft' || q.status === 'sent';
      return st === 'all' || q.status === st;
    });
    if (!list.length) { var tr0 = el('tr'); var td0 = el('td', 'No quotes in this view.', 'empty'); td0.colSpan = 7; tr0.appendChild(td0); tb.appendChild(tr0); }
    list.forEach(function (q) {
      var r = inquiry(q.inquiry_id) || {};
      var tr = el('tr'); tr.tabIndex = 0;
      [O.quoteNo(q), (r.name || '—') + (r.is_test ? ' (test)' : ''), A.fmtDate(r.event_date), A.money(q.total)].forEach(function (v) { tr.appendChild(el('td', v)); });
      var s = el('td'); s.appendChild(el('span', O.QUOTE_LABEL[q.status] + (O.pastValid(q) ? ' · past valid date' : ''), 'pill q-' + q.status)); tr.appendChild(s);
      tr.appendChild(el('td', q.sent_on ? A.fmtDate(q.sent_on) : '—'));
      tr.appendChild(el('td', q.valid_until ? A.fmtDate(q.valid_until) : '—', O.pastValid(q) ? 'due' : ''));
      tr.addEventListener('click', function () { Q.open(q.id); });
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') Q.open(q.id); });
      tb.appendChild(tr);
    });
    // inquiries that can receive a quote
    var sel = $('q-for'), keep = sel.value; sel.textContent = '';
    sel.appendChild(el('option', 'Choose an inquiry…')).value = '';
    A.bookings.rows.filter(function (r) { return (tests || !r.is_test) && ['declined', 'lost', 'completed'].indexOf(r.status) === -1; })
      .forEach(function (r) {
        var o = el('option', r.name + (r.is_test ? ' (test)' : '') + ' — ' + (r.event_date ? A.fmtDate(r.event_date) : 'no date') + ' · ' + A.STATUS_LABEL[r.status]);
        o.value = r.id; sel.appendChild(o);
      });
    sel.value = keep;
  }
  ['q-status', 'q-tests'].forEach(function (id) { $(id).addEventListener('change', renderList); });
  $('q-new').addEventListener('click', function () {
    var id = $('q-for').value;
    if (!id) { A.toast('Choose the inquiry this quote is for.', true); return; }
    Q.create(id);
  });

  // ---------- editor ----------
  var Q = A.quoteEditor = {};
  var cur = null; // the quote being edited (a copy)
  var dlg = $('quote-dialog');

  function nextVersion(inquiryId) { var ex = O.quotesFor(inquiryId); return ex.length ? ex[0].version + 1 : 1; }
  // A new quote is NOT saved (and gets no number) until you click Save, Approve & Send, or Mark accepted.
  Q.create = function (inquiryId) {
    var r = inquiry(inquiryId);
    if (!r) return;
    show({ id: null, inquiry_id: inquiryId, version: nextVersion(inquiryId), status: 'draft', quote_number: null,
      guest_count: r.guest_count || null, service_duration: r.service_duration || null, beverages: [], line_items: [],
      travel_fee: 0, discount: 0, subtotal: 0, total: 0, valid_until: null, client_notes: null, internal_notes: null });
  };
  Q.open = function (id) {
    var q = O.quotes.filter(function (x) { return x.id === id; })[0];
    if (q) show(q);
  };
  function show(q) {
    cur = JSON.parse(JSON.stringify(q));
    var r = inquiry(q.inquiry_id) || {};
    $('qd-title').textContent = q.id ? 'Quote ' + O.quoteNo(q) : (q.version > 1 ? 'New version (rev. ' + q.version + ')' : 'New quote') + ' — number assigned when you first save';
    $('qd-meta').textContent = (r.name || '') + (r.is_test ? ' (test inquiry)' : '') + (r.email ? ' · ' + r.email : '');
    var stp = $('qd-status'); stp.textContent = q.id ? O.QUOTE_LABEL[q.status] + (O.pastValid(q) ? ' · past valid date' : '') : 'Not saved yet'; stp.className = 'pill q-' + q.status;
    var ev = $('qd-event'); ev.textContent = '';
    [['Event', r.event_type], ['Date', r.event_date && A.fmtDate(r.event_date)], ['Time', O.timeRange(r)], ['Location', O.place(r)]]
      .forEach(function (p) { if (!p[1]) return; ev.appendChild(el('dt', p[0])); ev.appendChild(el('dd', p[1])); });
    $('qd-guests').value = q.guest_count || '';
    $('qd-duration').value = q.service_duration || '';
    $('qd-valid').value = q.valid_until || '';
    $('qd-travel').value = Number(q.travel_fee || 0).toFixed(2);
    $('qd-discount').value = Number(q.discount || 0).toFixed(2);
    $('qd-client-notes').value = q.client_notes || '';
    $('qd-internal-notes').value = q.internal_notes || '';
    renderBeverages();
    renderLines();
    var editable = q.status === 'draft';
    $('qd-fields').disabled = !editable;
    $('qd-save').hidden = !editable;
    $('qd-send').hidden = !editable;
    $('qd-sent').hidden = !editable;
    $('qd-delete').hidden = !editable;
    $('qd-delete').textContent = q.id ? 'Delete draft' : 'Discard';
    $('qd-accept').hidden = !(q.status === 'draft' || q.status === 'sent');
    $('qd-decline').hidden = q.status !== 'sent';
    $('qd-expire').hidden = q.status !== 'sent';
    $('qd-version').hidden = !q.id;
    $('qd-print').hidden = !q.id;
    var mail = q.id ? O.emails.filter(function (e) { return e.quote_id === q.id && e.kind === 'quote'; })[0] : null;
    $('qd-msg').textContent = mail ? 'Emailed to ' + mail.to_email + ' · ' + O.EMAIL_LABEL[mail.status] + (O.emailBad(mail) ? ' — retry from the booking’s Communication history.' : '.')
      : (editable ? '' : 'This quote is ' + O.QUOTE_LABEL[q.status].toLowerCase() + ' and can no longer be edited. Use New version to change it.');
    if (!dlg.open) dlg.showModal();
  }
  $('qd-close').addEventListener('click', function () { dlg.close(); });

  // beverage selection: names from the RAAHA menu (no menu prices are used)
  function renderBeverages() {
    var box = $('qd-bev'); box.textContent = '';
    var chosen = (cur.beverages || []).slice();
    var cats = A.content.list('menu_category').map(function (r) { return r.draft || {}; });
    var items = A.content.list('menu_item').map(function (r) { return r.draft || {}; }).filter(function (v) { return v.name && v.visible !== false; });
    cats.forEach(function (c) {
      var mine = items.filter(function (v) { return v.category === c.slug; });
      if (!mine.length) return;
      var g = el('fieldset', null, 'bev-group'); g.appendChild(el('legend', c.name || c.slug));
      mine.forEach(function (v) {
        var l = el('label', null, 'check'), cb = A.input('checkbox');
        cb.checked = chosen.indexOf(v.name) !== -1;
        cb.addEventListener('change', function () {
          var list = cur.beverages || [];
          if (cb.checked && list.indexOf(v.name) === -1) list.push(v.name);
          if (!cb.checked) list = list.filter(function (x) { return x !== v.name; });
          cur.beverages = list;
        });
        l.appendChild(cb); l.appendChild(document.createTextNode(' ' + v.name + (A.onCart && A.onCart(v) ? ' ·cart' : '')));
        g.appendChild(l);
      });
      box.appendChild(g);
    });
    // anything chosen earlier that is no longer on the menu stays listed
    chosen.filter(function (n) { return !items.some(function (v) { return v.name === n; }); }).forEach(function (n) {
      var l = el('label', null, 'check'), cb = A.input('checkbox'); cb.checked = true;
      cb.addEventListener('change', function () { cur.beverages = (cur.beverages || []).filter(function (x) { return x !== n || cb.checked; }); });
      l.appendChild(cb); l.appendChild(document.createTextNode(' ' + n + ' (no longer on the menu)')); box.appendChild(l);
    });
  }

  function renderLines() {
    var tb = $('qd-lines').querySelector('tbody'); tb.textContent = '';
    (cur.line_items || []).forEach(function (li, i) {
      var tr = el('tr');
      var d = A.input('text', li.desc, { maxlength: 200, 'aria-label': 'Description', placeholder: 'e.g. Espresso & chai service, 3 hours' });
      var q = A.input('number', li.qty, { min: 0, step: 'any', 'aria-label': 'Quantity' });
      var p = A.input('number', li.unit_price, { min: 0, step: '0.01', 'aria-label': 'Unit price' });
      var amt = el('td', '', 'num');
      function upd() { li.desc = d.value; li.qty = q.value === '' ? '' : Number(q.value); li.unit_price = p.value === '' ? '' : Number(p.value); amt.textContent = A.money(r2(num(li.qty) * num(li.unit_price))); totals(); }
      [d, q, p].forEach(function (x) { x.addEventListener('input', upd); });
      [d, q, p].forEach(function (x) { var td = el('td'); td.appendChild(x); tr.appendChild(td); });
      tr.appendChild(amt);
      var rm = el('button', '×', 'link'); rm.type = 'button'; rm.setAttribute('aria-label', 'Remove line');
      rm.addEventListener('click', function () { cur.line_items.splice(i, 1); renderLines(); });
      var td = el('td'); td.appendChild(rm); tr.appendChild(td);
      tb.appendChild(tr);
      amt.textContent = A.money(r2(num(li.qty) * num(li.unit_price)));
    });
    totals();
  }
  $('qd-add-line').addEventListener('click', function () {
    cur.line_items = cur.line_items || [];
    cur.line_items.push({ desc: '', qty: 1, unit_price: '' });
    renderLines();
    var rows = $('qd-lines').querySelectorAll('tbody tr'); rows[rows.length - 1].querySelector('input').focus();
  });
  // preview only — the database recalculates the same way on save
  function calc() {
    var sub = (cur.line_items || []).reduce(function (s, li) { return s + r2(num(li.qty) * num(li.unit_price)); }, 0);
    sub = r2(sub);
    return { sub: sub, total: r2(sub + num($('qd-travel').value) - num($('qd-discount').value)) };
  }
  function totals() { var t = calc(); $('qd-subtotal').textContent = A.money(t.sub); $('qd-total').textContent = A.money(t.total); $('qd-total').classList.toggle('neg', t.total < 0); }
  ['qd-travel', 'qd-discount'].forEach(function (id) { $(id).addEventListener('input', totals); });

  function collect() {
    var lines = (cur.line_items || []).filter(function (li) { return String(li.desc || '').trim() || num(li.unit_price); })
      .map(function (li) { return { desc: String(li.desc || '').trim().slice(0, 200), qty: num(li.qty), unit_price: r2(num(li.unit_price)) }; });
    return {
      guest_count: $('qd-guests').value ? Number($('qd-guests').value) : null,
      service_duration: $('qd-duration').value.trim() || null,
      valid_until: $('qd-valid').value || null,
      travel_fee: r2(num($('qd-travel').value)),
      discount: r2(num($('qd-discount').value)),
      beverages: cur.beverages || [],
      line_items: lines,
      client_notes: $('qd-client-notes').value.trim() || null,
      internal_notes: $('qd-internal-notes').value.trim() || null
    };
  }
  function check(p, forSending) {
    if (p.line_items.some(function (li) { return !li.desc; })) return 'Every charge line needs a description.';
    if (p.line_items.some(function (li) { return li.qty < 0 || li.unit_price < 0; })) return 'Quantities and prices cannot be negative. Use the discount field.';
    if (calc().total < 0) return 'The discount is larger than the quote.';
    if (forSending && !p.line_items.length) return 'Add at least one priced line before sending.';
    if (forSending && !(calc().total > 0)) return 'The quote total is $0. Enter the amounts before sending.';
    return null;
  }
  // Save: the first save creates the quote (and its number); later saves update it
  function persist(fields) {
    var op = cur.id ? db.from('booking_quotes').update(fields).eq('id', cur.id).select()
      : db.from('booking_quotes').insert(Object.assign({ inquiry_id: cur.inquiry_id, version: cur.version }, fields)).select();
    return op.then(function (res) {
      if (res.error || !res.data || !res.data.length) throw new Error(res.error ? res.error.message : 'no permission');
      var q = res.data[0];
      if (O.quotes.some(function (x) { return x.id === q.id; })) O.quotes = O.quotes.map(function (x) { return x.id === q.id ? q : x; });
      else O.quotes.unshift(q);
      cur = JSON.parse(JSON.stringify(q));
      O.changed();
      return q;
    });
  }
  function patch(fields, okMsg) {
    $('qd-msg').textContent = 'Saving…';
    return persist(fields).then(function (q) {
      show(q);
      var m = okMsg + ' ' + O.quoteNo(q) + ' · total ' + A.money(q.total) + ' (calculated by the database).';
      $('qd-msg').textContent = m; A.toast(m);
      return q;
    }, function (e) { $('qd-msg').textContent = 'Not saved: ' + e.message; A.toast('Not saved: ' + e.message, true); throw e; });
  }

  $('qd-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var p = collect(), err = check(p, false);
    if (err) { $('qd-msg').textContent = err; return; }
    patch(p, 'Draft saved.').catch(function () {});
  });

  // Approve & Send: save, review the email, then the server builds the PDF and sends it.
  $('qd-send').addEventListener('click', function () {
    var p = collect(), err = check(p, true);
    if (err) { $('qd-msg').textContent = err; return; }
    var r = inquiry(cur.inquiry_id) || {};
    if (!r.email) { $('qd-msg').textContent = 'This booking has no customer email address.'; return; }
    patch(p, 'Saved.').then(function (q) {
      var first = String(r.name || '').trim().split(/\s+/)[0] || 'there';
      A.comms.compose({
        title: 'Approve & send ' + O.quoteNo(q), to: r.email, sendLabel: 'Approve & Send',
        subject: 'Your RAAHA quote ' + q.quote_number + (q.version > 1 ? ' (revision ' + q.version + ')' : ''), subjectLocked: true,
        bodyLabel: 'Message above the quote details',
        body: 'Hi ' + first + ',\n\nThank you for considering RAAHA Soul House for your ' + (r.event_type ? r.event_type.toLowerCase() : 'event') + '. Your custom quote is attached as a PDF.',
        attach: 'Attached automatically: ' + q.quote_number + (q.version > 1 ? '-rev' + q.version : '') + '.pdf · total ' + A.money(q.total) +
          (q.valid_until ? ' · valid until ' + A.fmtDate(q.valid_until) : '') + '. The email also says the date is reserved only after acceptance and deposit.',
        onSend: function (subject, body) {
          return O.invoke('send_quote', { quote_id: q.id, note: body }).then(function (res) {
            return O.refresh().then(function () { Q.open(q.id); return res; });
          });
        }
      });
    }).catch(function () {});
  });
  $('qd-sent').addEventListener('click', function () {
    var p = collect(), err = check(p, true);
    if (err) { $('qd-msg').textContent = err; return; }
    if (!confirm('Record this quote as sent outside RAAHA Admin (for example from Gmail)?\n\nNothing is emailed from here. Use “Approve & Send to customer” to email it with the PDF attached.')) return;
    p.status = 'sent'; p.sent_on = A.today();
    patch(p, 'Recorded as sent.').then(function () {
      var r = inquiry(cur.inquiry_id);
      if (r && (r.status === 'new' || r.status === 'contacted')) return db.from('inquiries').update({ status: 'quoted' }).eq('id', r.id).then(function () { return O.refresh(); });
    }).catch(function () {});
  });

  // Mark accepted: needs the date and how the customer accepted. Never confirms the booking.
  var ad = $('accept-dialog');
  $('qd-accept').addEventListener('click', function () {
    var p = collect();
    if (cur.status === 'draft') { var err = check(p, true); if (err) { $('qd-msg').textContent = err; return; } }
    $('ad-quote').textContent = (cur.id ? O.quoteNo(cur) : 'This new quote') + ' · ' + A.money(calc().total);
    $('ad-date').value = A.today(); $('ad-ref').value = ''; $('ad-msg').textContent = '';
    ad.showModal();
  });
  $('ad-cancel').addEventListener('click', function () { ad.close(); });
  $('ad-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var ref = $('ad-ref').value.trim(), date = $('ad-date').value || A.today();
    if (!ref) { $('ad-msg').textContent = 'Write how the customer accepted (for example the email they sent).'; return; }
    $('ad-msg').textContent = 'Saving…';
    var go = cur.status === 'draft' ? persist(collect()) : Promise.resolve(cur);
    go.then(function (q) { return db.rpc('accept_quote', { p_quote_id: q.id, p_reference: ref, p_accepted_on: date }).then(function (res) { return { res: res, q: q }; }); })
      .then(function (o) {
        if (o.res.error) { $('ad-msg').textContent = 'Not accepted: ' + o.res.error.message; return; }
        ad.close();
        A.toast('Acceptance recorded. Next: record the verified deposit on the booking, then Confirm & Send.');
        return O.refresh().then(function () { Q.open(o.q.id); });
      }).catch(function (err) { $('ad-msg').textContent = 'Not saved: ' + err.message; });
  });
  $('qd-decline').addEventListener('click', function () {
    if (!confirm('Mark this quote as declined by the client?')) return;
    patch({ status: 'declined', responded_on: A.today() }, 'Marked declined.').catch(function () {});
  });
  $('qd-expire').addEventListener('click', function () {
    if (!confirm('Mark this quote as expired?')) return;
    patch({ status: 'expired' }, 'Marked expired.').catch(function () {});
  });
  // New version: a copy (including Valid until) that is saved only when you click Save
  $('qd-version').addEventListener('click', function () {
    var b = cur;
    show({ id: null, inquiry_id: b.inquiry_id, version: nextVersion(b.inquiry_id), status: 'draft', quote_number: b.quote_number,
      guest_count: b.guest_count, service_duration: b.service_duration, beverages: (b.beverages || []).slice(), line_items: JSON.parse(JSON.stringify(b.line_items || [])),
      travel_fee: b.travel_fee, discount: b.discount, subtotal: b.subtotal, total: b.total, valid_until: b.valid_until,
      client_notes: b.client_notes, internal_notes: b.internal_notes });
    $('qd-msg').textContent = 'New version copied from ' + O.quoteNo(b) + '. Change what you need, then Save or Approve & Send. The earlier version is kept.';
  });
  $('qd-delete').addEventListener('click', function () {
    if (!cur.id) { dlg.close(); return; }
    if (cur.status !== 'draft' || !confirm('Delete this draft quote? Sent and answered quotes are always kept.')) return;
    db.from('booking_quotes').delete().eq('id', cur.id).eq('status', 'draft').then(function (res) {
      if (res.error) { $('qd-msg').textContent = 'Not deleted: ' + res.error.message; return; }
      O.quotes = O.quotes.filter(function (x) { return x.id !== cur.id; });
      O.changed(); dlg.close(); A.toast('Draft deleted.');
    });
  });

  // ---------- printable quote (save as PDF from the print window) ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  Q.printHtml = function (q, r) {
    var lines = (q.line_items || []).map(function (li) {
      return '<tr><td>' + esc(li.desc) + '</td><td class="n">' + esc(li.qty) + '</td><td class="n">' + A.money(li.unit_price) +
        '</td><td class="n">' + A.money(r2(num(li.qty) * num(li.unit_price))) + '</td></tr>';
    }).join('');
    var ev = [['Event', r.event_type], ['Date', r.event_date && A.fmtDate(r.event_date)], ['Time', O.timeRange(r)],
      ['Location', O.place(r)], ['Guests', q.guest_count], ['Service', q.service_duration]]
      .filter(function (p) { return p[1]; }).map(function (p) { return '<div><dt>' + p[0] + '</dt><dd>' + esc(p[1]) + '</dd></div>'; }).join('');
    var bev = (q.beverages || []).length ? '<h2>Beverage selection</h2><p class="bev">' + q.beverages.map(esc).join(' · ') + '</p>' : '';
    var dep = Number(r.deposit_amount) > 0 ? '<p class="dep">Deposit to reserve your date: <strong>' + A.money(r.deposit_amount) + '</strong>' +
      (r.deposit_due_on ? ' by ' + A.fmtDate(r.deposit_due_on) : '') + '. Your date is confirmed once the deposit is received.</p>' : '';
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>RAAHA quote ' + esc(q.quote_number || '') + (q.version > 1 ? ' rev ' + q.version : '') + '</title>' +
      '<style>@page{margin:18mm}body{font-family:Georgia,"Times New Roman",serif;color:#2E2A27;margin:0;font-size:11pt;line-height:1.45}' +
      '.top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #762F2B;padding-bottom:14px;margin-bottom:18px}' +
      '.top img{height:64px}.brand{font-size:9pt;letter-spacing:.18em;color:#762F2B;text-transform:uppercase;margin-top:6px}' +
      '.meta{text-align:right;font-size:10pt}.meta h1{font-size:20pt;margin:0 0 4px;color:#762F2B;font-weight:normal}' +
      'h2{font-size:11pt;letter-spacing:.12em;text-transform:uppercase;color:#762F2B;margin:20px 0 6px;font-weight:normal}' +
      'dl{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 18px;margin:0}dt{font-size:8.5pt;text-transform:uppercase;letter-spacing:.1em;color:#7a6f66}dd{margin:0}' +
      'table{width:100%;border-collapse:collapse;margin-top:6px}th{text-align:left;font-size:8.5pt;text-transform:uppercase;letter-spacing:.1em;color:#7a6f66;border-bottom:1px solid #C9A86A;padding:6px 4px}' +
      'td{padding:7px 4px;border-bottom:1px solid #eadfce;vertical-align:top}.n{text-align:right;white-space:nowrap}' +
      '.tot{margin-left:auto;width:280px;margin-top:10px}.tot div{display:flex;justify-content:space-between;padding:3px 4px}.tot .g{border-top:2px solid #762F2B;font-size:13pt;margin-top:4px;padding-top:6px}' +
      '.notes{white-space:pre-wrap}.dep{background:#F4EDE4;padding:10px 12px;border-left:3px solid #C9A86A}.foot{margin-top:28px;font-size:9pt;color:#7a6f66;border-top:1px solid #eadfce;padding-top:10px}' +
      '.bev{margin:0}</style></head><body>' +
      '<div class="top"><div><img src="' + location.origin + '/assets/images/brand/raaha-logo-burgundy.png" alt="RAAHA Soul House"><div class="brand">RAAHA Soul House · Coffee Cart</div></div>' +
      '<div class="meta"><h1>Quote</h1>' + esc(q.quote_number || '') + (q.version > 1 ? '<br>Revision ' + q.version : '') + '<br>Prepared ' + A.fmtDate(q.sent_on || A.today()) +
      (q.valid_until ? '<br>Valid until ' + A.fmtDate(q.valid_until) : '') + '</div></div>' +
      '<h2>Prepared for</h2><p>' + esc(r.name) + (r.email ? '<br>' + esc(r.email) : '') + (r.phone ? '<br>' + esc(r.phone) : '') + '</p>' +
      (ev ? '<h2>Event</h2><dl>' + ev + '</dl>' : '') + bev +
      '<h2>Quote</h2><table><thead><tr><th>Description</th><th class="n">Qty</th><th class="n">Unit price</th><th class="n">Amount</th></tr></thead><tbody>' + lines + '</tbody></table>' +
      '<div class="tot"><div><span>Subtotal</span><span>' + A.money(q.subtotal) + '</span></div>' +
      (Number(q.travel_fee) ? '<div><span>Travel fee</span><span>' + A.money(q.travel_fee) + '</span></div>' : '') +
      (Number(q.discount) ? '<div><span>Discount</span><span>−' + A.money(q.discount) + '</span></div>' : '') +
      '<div class="g"><strong>Total</strong><strong>' + A.money(q.total) + '</strong></div></div>' +
      (q.client_notes ? '<h2>Notes</h2><p class="notes">' + esc(q.client_notes) + '</p>' : '') + dep +
      '<p class="foot">RAAHA Soul House · Houston, Texas · hello@raahasoulhouse.com · raahasoulhouse.com<br>This is a custom quote prepared for your event.</p>' +
      '</body></html>';
  };
  $('qd-print').addEventListener('click', function () {
    if (!cur.id) { $('qd-msg').textContent = 'Save the quote first.'; return; }
    var q = O.quotes.filter(function (x) { return x.id === cur.id; })[0] || cur, r = inquiry(q.inquiry_id) || {};
    if (q.status === 'draft' && JSON.stringify(collect().line_items) !== JSON.stringify(q.line_items || [])) {
      $('qd-msg').textContent = 'Save the draft first so the printed quote matches.'; return;
    }
    var w = window.open('', '_blank');
    if (!w) { A.toast('Allow pop-ups for this page to print the quote.', true); return; }
    w.document.open(); w.document.write(Q.printHtml(q, r)); w.document.close();
    var img = w.document.querySelector('img');
    var go = function () { w.focus(); w.print(); };
    if (img && !img.complete) { img.onload = go; img.onerror = go; } else setTimeout(go, 200);
  });

  O.onChange(renderList);
  A.modules.push({ tab: 'quotes', onShow: renderList });
})();
