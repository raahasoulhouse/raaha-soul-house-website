/* RAAHA admin — customer communication and booking steps.
   Reply to customer · Record customer response · Confirm & Send · Mark as test · Communication history · Email settings.
   Emails go out through the raaha-email function (Resend, from hello@raahasoulhouse.com, replies to Gmail).
   Nothing here accepts a quote, verifies a payment or confirms a booking without an explicit click,
   and the database re-checks every rule (accepted quote, verified deposit, calendar conflicts). */
(function () {
  'use strict';
  var A = window.RAAHA_ADMIN, $ = A.$, el = A.el, db = A.db, O = A.ops;
  var C = A.comms = {};
  var cur = null;

  function firstName(n) { return String(n || '').trim().split(/\s+/)[0] || 'there'; }
  function kind(r) { return r.inquiry_type === 'gathering' ? 'event' : 'Coffee Cart'; }
  function refresh() { return O.refresh(); }

  // ---------- what to do next ----------
  function nextStep(r) {
    var acc = O.acceptedQuote(r.id), dep = O.depositComplete(r);
    var conf = O.emailsFor(r.id).filter(function (e) { return e.kind === 'confirmation'; })[0];
    switch (r.status) {
      case 'new': return 'Next: reply to the customer (Reply to customer), then create a quote.';
      case 'contacted': return 'Next: create the quote below, review it, then Approve & Send.';
      case 'quoted': return 'Quote sent. When the customer answers in Gmail, use Record customer response.';
      case 'quote_accepted': return dep ? 'Deposit recorded — click Confirm & Send.' :
        'Quote accepted. When the deposit arrives, check your bank or payment app, record the amount, date and reference under Payments, then Save.';
      case 'deposit_verified': return acc ? 'Deposit verified — click Confirm & Send.' : 'Deposit verified, but no accepted quote: record the customer’s acceptance first.';
      case 'confirmed':
        if (!conf) return 'Booking confirmed. No confirmation email has been sent yet — use Confirm & Send to send it.';
        if (O.emailBad(conf)) return '⚠ Booking confirmed, but the confirmation email needs attention (see Communication history).';
        return 'Booking confirmed · confirmation email ' + O.EMAIL_LABEL[conf.status].toLowerCase() + '. ' + O.payment(r).label + '.';
      case 'completed': return 'Event completed · ' + O.payment(r).label + '.';
      default: return '';
    }
  }

  C.render = function (r) {
    cur = r;
    $('d-is-test').checked = !!r.is_test;
    var acc = O.acceptedQuote(r.id), dep = O.depositComplete(r);
    var b = $('d-confirm');
    var conf = O.emailsFor(r.id).filter(function (e) { return e.kind === 'confirmation'; })[0];
    if (r.status === 'confirmed' && (!conf || O.emailBad(conf))) { b.disabled = false; b.textContent = conf ? 'Resend confirmation' : 'Send confirmation email'; }
    else if (r.status === 'confirmed' || r.status === 'completed') { b.disabled = true; b.textContent = 'Confirmed ✓'; }
    else { b.textContent = 'Confirm & Send'; b.disabled = !(acc && dep && (r.status === 'deposit_verified' || r.status === 'quote_accepted')); }
    b.title = b.disabled && r.status !== 'confirmed' && r.status !== 'completed' ? 'Needs an accepted quote and a verified deposit (amount, date received and reference).' : '';
    var nx = $('d-next'); nx.textContent = nextStep(r); nx.className = 'd-next' + (/⚠/.test(nx.textContent) ? ' warn' : '');
    renderComms(r);
  };

  function renderComms(r) {
    var ul = $('d-comms'); ul.textContent = '';
    var list = O.emailsFor(r.id);
    if (!list.length) { ul.appendChild(el('li', 'No emails sent from Admin yet.', 'muted')); return; }
    list.forEach(function (e) {
      var li = el('li', null, 'comm' + (O.emailBad(e) ? ' bad' : ''));
      var top = el('div', null, 'comm-top');
      top.appendChild(el('strong', O.EMAIL_KIND[e.kind] || e.kind));
      top.appendChild(el('span', O.EMAIL_LABEL[e.status] || e.status, 'pill em-' + e.status));
      top.appendChild(el('span', A.fmtDateTime(e.created_at), 'muted small'));
      li.appendChild(top);
      li.appendChild(el('div', e.subject + ' → ' + e.to_email, 'small'));
      if (e.error && e.status !== 'accepted' && e.status !== 'delivered') li.appendChild(el('div', e.error, 'small comm-err'));
      if (O.emailBad(e)) {
        var rb = el('button', 'Retry safely', 'link'); rb.type = 'button';
        rb.addEventListener('click', function () {
          rb.disabled = true; rb.textContent = 'Retrying…';
          O.invoke('retry', { email_id: e.id }).then(function (res) {
            A.toast(res.ok ? (res.duplicate ? 'Already sent — nothing sent twice.' : 'Sent — accepted by the email provider.') : 'Not sent: ' + (res.error || 'unknown error'), !res.ok);
            return refresh();
          });
        });
        li.appendChild(rb);
      }
      ul.appendChild(li);
    });
  }

  // ---------- generic compose dialog (used by Reply and by Approve & Send Quote) ----------
  var cd = $('compose-dialog'), sendFn = null, sending = false;
  C.compose = function (o) {
    $('cd-title').textContent = o.title; $('cd-to').textContent = o.to;
    $('cd-subject').value = o.subject || ''; $('cd-subject').readOnly = !!o.subjectLocked;
    $('cd-body').value = o.body || ''; $('cd-body-label').textContent = o.bodyLabel || 'Message';
    $('cd-attach').textContent = o.attach || ''; $('cd-msg').textContent = ''; $('cd-send').textContent = o.sendLabel || 'Send email';
    $('cd-send').disabled = false; sendFn = o.onSend; sending = false;
    if (!cd.open) cd.showModal();
    setTimeout(function () { var t = $('cd-body'); t.focus(); var i = t.value.indexOf('\n\n\n'); if (i > -1) t.setSelectionRange(i + 2, i + 2); }, 50);
  };
  $('cd-cancel').addEventListener('click', function () { cd.close(); });
  $('cd-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (sending || !sendFn) return;
    var subject = $('cd-subject').value.trim(), body = $('cd-body').value.trim();
    if (!subject) { $('cd-msg').textContent = 'Add a subject.'; return; }
    if (!body) { $('cd-msg').textContent = 'Write a message.'; return; }
    sending = true; $('cd-send').disabled = true; $('cd-msg').textContent = 'Sending…';
    sendFn(subject, body).then(function (res) {
      sending = false; $('cd-send').disabled = false;
      if (res && res.ok) {
        cd.close();
        A.toast(res.duplicate ? 'This email was already sent — nothing was sent twice.' : 'Sent — accepted by the email provider. It now appears in Communication history.');
      } else {
        $('cd-msg').textContent = (res && res.error ? res.error : 'Not sent.') + ' You can click Send again: it will not create a duplicate.';
      }
      return refresh();
    });
  });

  // ---------- Reply to customer ----------
  $('d-reply').addEventListener('click', function () {
    if (!cur) return;
    if (!cur.email) { A.toast('This booking has no email address.', true); return; }
    var key = O.newKey(), r = cur;
    C.compose({
      title: 'Reply to ' + r.name, to: r.email,
      subject: 'Re: Your RAAHA ' + kind(r) + ' inquiry',
      body: 'Hi ' + firstName(r.name) + ',\n\nThank you for your inquiry.\n\n\n\nWarmly,\nRAAHA Soul House',
      onSend: function (subject, body) { return O.invoke('reply', { inquiry_id: r.id, subject: subject, body: body, client_key: key }); }
    });
  });

  // ---------- Record customer response ----------
  var rd = $('response-dialog');
  $('d-response').addEventListener('click', function () {
    if (!cur) return;
    $('rd-date').value = A.today(); $('rd-summary').value = ''; $('rd-outcome').value = ''; $('rd-msg').textContent = '';
    var sent = O.quotesFor(cur.id).filter(function (q) { return q.status === 'sent'; })[0];
    $('rd-outcome').querySelector('option[value=accept]').textContent = sent ? 'Customer accepted ' + O.quoteNo(sent) + ' (' + A.money(sent.total) + ')' : 'Customer accepted the quote (no sent quote yet)';
    $('rd-outcome').querySelector('option[value=accept]').disabled = !sent;
    rd.showModal();
  });
  $('rd-cancel').addEventListener('click', function () { rd.close(); });
  $('rd-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var r = cur, date = $('rd-date').value || A.today(), ch = $('rd-channel').value, sum = $('rd-summary').value.trim(), out = $('rd-outcome').value;
    if (!sum) { $('rd-msg').textContent = 'Write what the customer said.'; return; }
    var ref = ch + ', ' + A.fmtDate(date) + ': ' + sum;
    $('rd-msg').textContent = 'Saving…';
    db.from('inquiry_notes').insert({ inquiry_id: r.id, body: 'Customer response — ' + ref }).then(function (res) {
      if (res.error) throw res.error;
      if (out === 'accept') {
        var sent = O.quotesFor(r.id).filter(function (q) { return q.status === 'sent'; })[0];
        if (!sent) throw new Error('No sent quote to accept.');
        return db.rpc('accept_quote', { p_quote_id: sent.id, p_reference: ref.slice(0, 300), p_accepted_on: date });
      }
      if (out === 'contacted' && r.status === 'new') return db.from('inquiries').update({ status: 'contacted' }).eq('id', r.id);
      if (out === 'declined') return db.from('inquiries').update({ status: 'declined', closed_reason: ('Customer declined — ' + ref).slice(0, 500) }).eq('id', r.id);
      return { error: null };
    }).then(function (res) {
      if (res && res.error) throw res.error;
      rd.close();
      A.toast(out === 'accept' ? 'Acceptance recorded. Next: record the verified deposit, then Confirm & Send.' : 'Customer response recorded.');
      return refresh();
    }).catch(function (err) { $('rd-msg').textContent = 'Not saved: ' + (err.message || err); });
  });

  // ---------- Mark as test ----------
  $('d-is-test').addEventListener('change', function () {
    var box = this, r = cur, on = box.checked;
    if (!r) return;
    if (!confirm(on ? 'Mark “' + r.name + '” as a TEST record?\n\nIt will be hidden from business totals and never emailed automatically. Existing quote numbers stay as they are.'
                    : 'Mark “' + r.name + '” as a genuine customer record again?')) { box.checked = !on; return; }
    db.from('inquiries').update({ is_test: on }).eq('id', r.id).then(function (res) {
      if (res.error) { box.checked = !on; A.toast('Not changed: ' + res.error.message, true); return; }
      A.toast(on ? 'Marked as a test record.' : 'Marked as a genuine record.');
      return refresh();
    });
  });

  // ---------- Confirm & Send ----------
  $('d-confirm').addEventListener('click', function () {
    var r = cur, btn = this;
    if (!r) return;
    var acc = O.acceptedQuote(r.id);
    var sendOnly = r.status === 'confirmed';
    var msg = sendOnly ? 'Send the booking confirmation email to ' + r.email + '?' :
      'Confirm this booking and email the customer?\n\n• Accepted quote: ' + (acc ? O.quoteNo(acc) + ' · ' + A.money(acc.total) : '—') +
      '\n• Deposit: ' + A.money(r.deposit_amount) + ' received ' + A.fmtDate(r.deposit_received_on) + ' (ref. ' + r.payment_reference + ')' +
      '\n• Event: ' + A.fmtDate(r.event_date) + (O.timeRange(r) ? ', ' + O.timeRange(r) : ' (no time set)') + (O.place(r) ? ' · ' + O.place(r) : '') +
      '\n\nThe calendar is checked again before confirming. The confirmation email goes to ' + r.email + '.';
    if (!confirm(msg)) return;
    btn.disabled = true; btn.textContent = sendOnly ? 'Sending…' : 'Confirming…';
    var step = sendOnly ? Promise.resolve({ error: null }) : db.from('inquiries').update({ status: 'confirmed' }).eq('id', r.id).select();
    step.then(function (res) {
      if (res.error) {
        $('d-msg').textContent = res.error.message;
        A.toast('Not confirmed: ' + res.error.message, true);
        btn.disabled = false; btn.textContent = 'Confirm & Send';
        return refresh();
      }
      btn.textContent = 'Sending confirmation…';
      return O.invoke('send_confirmation', { inquiry_id: r.id }).then(function (er) {
        if (er.ok) A.toast(er.duplicate ? 'Booking confirmed. The confirmation email had already been sent.' : 'Booking confirmed and the confirmation email was accepted for delivery.');
        else A.toast('Booking confirmed, but the confirmation email needs attention: ' + (er.error || 'not sent') + ' Use Retry in Communication history.', true);
        return refresh();
      });
    });
  });

  // ---------- Settings: email setup, auto-acknowledgment, template previews ----------
  function loadEmailSettings() {
    if (!O.emailReady) { $('em-status').textContent = 'Email features need the database update.'; return; }
    $('em-status').textContent = 'Checking email setup…';
    O.invoke('status').then(function (s) {
      if (!s || s.ok === false) { $('em-status').textContent = 'Email service not reachable: ' + ((s && s.error) || 'unknown error'); return; }
      $('em-status').textContent = s.configured
        ? 'Email sending is set up (' + s.from + ', replies to ' + s.reply_to + ').' + (s.webhook ? ' Delivery updates are on.' : ' Delivery updates (Delivered / Bounced) are not set up yet; emails show “Sent (accepted by provider)”.')
        : 'Email sending is NOT set up yet: the Resend key has not been added to Supabase. Sending will show “Failed — not set up” until it is.';
      $('em-status').className = s.configured ? '' : 'warn-text';
      $('em-auto-ack').checked = !!s.auto_ack;
    });
  }
  $('em-auto-ack').addEventListener('change', function () {
    var box = this, on = box.checked;
    if (on && !confirm('Turn on automatic acknowledgment?\n\nEvery new genuine inquiry from the website will receive the acknowledgment email shown in “Preview: inquiry acknowledgment”. TEST inquiries are never emailed.')) { box.checked = false; return; }
    db.rpc('set_auto_ack', { p_enabled: on }).then(function (res) {
      if (res.error) { box.checked = !on; A.toast('Not changed: ' + res.error.message, true); return; }
      A.toast(on ? 'Automatic acknowledgment is on.' : 'Automatic acknowledgment is off.');
    });
  });
  document.querySelectorAll('#email-settings [data-preview]').forEach(function (b) {
    b.addEventListener('click', function () {
      var box = $('em-preview'); box.hidden = false; box.textContent = 'Loading…';
      O.invoke('preview', { template: b.dataset.preview }).then(function (p) {
        box.textContent = '';
        if (!p.ok) { box.textContent = 'Preview not available: ' + (p.error || ''); return; }
        box.appendChild(el('p', 'Subject: ' + p.subject, 'em-subject'));
        var f = document.createElement('iframe'); f.title = 'Email preview'; f.className = 'em-frame'; f.srcdoc = p.html; f.setAttribute('sandbox', '');
        box.appendChild(f);
        box.appendChild(el('p', 'Sample details shown. Real emails use the customer’s own details.', 'muted small'));
      });
    });
  });

  A.modules.push({ tab: 'settings', onShow: loadEmailSettings });
})();
