// RAAHA email service (Supabase Edge Function core). Plain JavaScript so it can also be tested in Node.
// Routes:  /raaha-email/admin    signed-in RAAHA admins: reply, send quote, send confirmation, retry, status
//          /raaha-email/ack      called by the database when a genuine inquiry arrives (auto-acknowledgment)
//          /raaha-email/webhook  Resend delivery updates (signed; needs RESEND_WEBHOOK_SECRET)
// The Resend key lives only in the function's secrets. Every email is recorded in public.email_log
// under a unique key, so a retry can never send the same message twice.

export const FROM = 'RAAHA Soul House <hello@raahasoulhouse.com>';
export const REPLY_TO = 'hello@raahasoulhouse.com';
export const SITE = 'https://www.raahasoulhouse.com';
const ALLOWED_ORIGINS = ['https://www.raahasoulhouse.com', 'https://raahasoulhouse.com'];

// ---------- formatting ----------
const TZ = 'America/Chicago';
export function todayChicago(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t).value;
  return g('year') + '-' + g('month') + '-' + g('day');
}
export function fmtDate(iso, long = true) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return dt.toLocaleDateString('en-US', long ? { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }
    : { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
export function fmtTime(t) {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  return ((h % 12) || 12) + ':' + String(m || 0).padStart(2, '0') + (h < 12 ? ' AM' : ' PM');
}
export function money(n) { return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function firstName(name) { const n = String(name || '').trim().split(/\s+/)[0]; return n || 'there'; }
function timeRange(inq) { return inq.event_start_time ? fmtTime(inq.event_start_time) + (inq.event_end_time ? ' – ' + fmtTime(inq.event_end_time) : '') : ''; }
function place(inq) { return inq.venue_address || inq.city_neighborhood || ''; }
function kindLabel(inq) { return inq.inquiry_type === 'gathering' ? 'event' : 'Coffee Cart'; }

// ---------- branded email layout ----------
function layout(innerHtml) {
  return '<!doctype html><html><body style="margin:0;background:#F4EDE4;padding:24px 12px;font-family:Georgia,\'Times New Roman\',serif;color:#2E2A27">' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">' +
    '<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden">' +
    '<tr><td style="padding:24px 32px;border-bottom:3px solid #762F2B"><img src="' + SITE + '/assets/images/brand/raaha-logo-burgundy.png" alt="RAAHA Soul House" height="48" style="display:block;height:48px"></td></tr>' +
    '<tr><td style="padding:28px 32px;font-size:16px;line-height:1.6">' + innerHtml + '</td></tr>' +
    '<tr><td style="padding:16px 32px;background:#FAF6F0;font-size:12px;color:#7a6f66">RAAHA Soul House · Houston, Texas · <a href="mailto:hello@raahasoulhouse.com" style="color:#762F2B">hello@raahasoulhouse.com</a> · <a href="' + SITE + '" style="color:#762F2B">raahasoulhouse.com</a></td></tr>' +
    '</table></td></tr></table></body></html>';
}
function detailRows(rows) {
  const r = rows.filter((x) => x[1] !== '' && x[1] != null);
  if (!r.length) return '';
  return '<table role="presentation" cellspacing="0" cellpadding="0" style="margin:12px 0 18px;border-collapse:collapse;font-size:15px">' +
    r.map((x) => '<tr><td style="padding:4px 18px 4px 0;color:#7a6f66;vertical-align:top;white-space:nowrap">' + esc(x[0]) + '</td><td style="padding:4px 0">' + esc(x[1]) + '</td></tr>').join('') + '</table>';
}
function detailText(rows) { return rows.filter((x) => x[1] !== '' && x[1] != null).map((x) => x[0] + ': ' + x[1]).join('\n'); }
function paras(text) { return String(text || '').split(/\n{2,}/).map((p) => '<p style="margin:0 0 14px">' + esc(p).replace(/\n/g, '<br>') + '</p>').join(''); }

// ---------- templates (shown in Admin → Settings) ----------
export function ackEmail(inq) {
  const rows = [['Event', inq.event_type || ''], ['Preferred date', fmtDate(inq.event_date)], ['Guests', inq.guest_count || ''],
    ['Location', place(inq)], ['Service length', inq.service_duration || '']];
  const subject = 'We received your RAAHA ' + kindLabel(inq) + ' inquiry';
  const intro = 'Hi ' + firstName(inq.name) + ',\n\nThank you for reaching out to RAAHA Soul House. We have received your ' + kindLabel(inq) + ' inquiry with these details:';
  const after = 'Please note: this email confirms that we received your request. It is not a booking confirmation, and your date is not reserved yet.\n\n' +
    'We review every request personally and will reply with next steps. If anything above needs correcting, simply reply to this email.\n\nWarmly,\nRAAHA Soul House';
  return { subject, html: layout(paras(intro) + detailRows(rows) + paras(after)), text: intro + '\n\n' + detailText(rows) + '\n\n' + after };
}
export function replyEmail(subject, body) { return { subject, html: layout(paras(body)), text: String(body) }; }
export function quoteEmail(inq, q, note) {
  const subject = 'Your RAAHA quote ' + q.quote_number + (q.version > 1 ? ' (revision ' + q.version + ')' : '');
  const rows = [['Quote', q.quote_number + (q.version > 1 ? ' · revision ' + q.version : '')], ['Event', inq.event_type || ''], ['Date', fmtDate(inq.event_date)],
    ['Total', money(q.total)], ['Valid until', q.valid_until ? fmtDate(q.valid_until) : '']];
  const intro = (note && String(note).trim()) ? String(note).trim() :
    'Hi ' + firstName(inq.name) + ',\n\nThank you for considering RAAHA Soul House for your ' + (inq.event_type ? inq.event_type.toLowerCase() : 'event') + '. Your custom quote is attached as a PDF.';
  const after = 'To accept, simply reply to this email. Your date is reserved only after you accept the quote and your deposit is received.\n\nWarmly,\nRAAHA Soul House';
  return { subject, html: layout(paras(intro) + detailRows(rows) + paras(after)), text: intro + '\n\n' + detailText(rows) + '\n\n' + after };
}
export function confirmationEmail(inq, q) {
  const subject = 'Your RAAHA booking is confirmed — ' + fmtDate(inq.event_date, false);
  const bal = Number(inq.balance_amount || 0);
  const rows = [['Event', inq.event_type || ''], ['Date', fmtDate(inq.event_date)], ['Time', timeRange(inq)], ['Location', place(inq)],
    ['Guests', (q && q.guest_count) || inq.guest_count || ''], ['Service length', (q && q.service_duration) || inq.service_duration || ''],
    ['Drinks', q && q.beverages && q.beverages.length ? q.beverages.join(', ') : ''], ['Quote', q ? q.quote_number + (q.version > 1 ? ' · revision ' + q.version : '') + ' · ' + money(q.total) : ''],
    ['Deposit received', inq.deposit_amount ? money(inq.deposit_amount) + (inq.deposit_received_on ? ' on ' + fmtDate(inq.deposit_received_on, false) : '') : ''],
    ['Remaining balance', inq.balance_received_on ? 'Paid' : (bal > 0 ? money(bal) + (inq.balance_due_on ? ' due by ' + fmtDate(inq.balance_due_on, false) : '') : '')]];
  const intro = 'Hi ' + firstName(inq.name) + ',\n\nThank you — your deposit has been received and your RAAHA booking is confirmed. Here are the details we have on file:';
  const after = 'If anything needs to change, please reply to this email as soon as possible.\n\nWe look forward to serving you and your guests.\n\nWarmly,\nRAAHA Soul House';
  return { subject, html: layout(paras(intro) + detailRows(rows) + paras(after)), text: intro + '\n\n' + detailText(rows) + '\n\n' + after };
}

// ---------- branded quote PDF ----------
export async function buildQuotePdf(PDFLib, logoBytes, q, inq) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.create();
  doc.setTitle('RAAHA quote ' + q.quote_number); doc.setAuthor('RAAHA Soul House'); doc.setCreator('RAAHA Admin');
  const F = await doc.embedFont(StandardFonts.TimesRoman), B = await doc.embedFont(StandardFonts.TimesRomanBold);
  const BURG = rgb(0.463, 0.184, 0.169), INK = rgb(0.18, 0.165, 0.153), MUTED = rgb(0.48, 0.435, 0.4), GOLD = rgb(0.788, 0.659, 0.416), RULE = rgb(0.918, 0.875, 0.808);
  const W = 612, H = 792, M = 54, R = W - M;
  let page, y;
  const clean = (font, s) => { let out = ''; for (const ch of String(s == null ? '' : s).replace(/−/g, '-').replace(/\r/g, '')) { if (ch === '\n') { out += ch; continue; } try { font.encodeText(ch); out += ch; } catch (e) { out += '?'; } } return out; };
  const width = (font, size, s) => font.widthOfTextAtSize(clean(font, s), size);
  const wrap = (font, size, s, maxW) => {
    const lines = [];
    for (const para of clean(font, s).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        const t = line ? line + ' ' + word : word;
        if (font.widthOfTextAtSize(t, size) <= maxW) line = t; else { if (line) lines.push(line); line = word; }
      }
      lines.push(line);
    }
    return lines;
  };
  const footer = () => page.drawText(clean(F, 'RAAHA Soul House · Houston, Texas · hello@raahasoulhouse.com · raahasoulhouse.com'), { x: M, y: 30, size: 8.5, font: F, color: MUTED });
  const newPage = () => { page = doc.addPage([W, H]); y = H - M; footer(); };
  const ensure = (h) => { if (y - h < 64) newPage(); };
  const text = (s, x, size, font = F, color = INK) => page.drawText(clean(font, s), { x, y, size, font, color });
  const rtext = (s, xr, size, font = F, color = INK) => page.drawText(clean(font, s), { x: xr - width(font, size, s), y, size, font, color });
  const heading = (s) => { ensure(36); y -= 22; text(s.toUpperCase(), M, 9.5, F, BURG); y -= 14; };
  newPage();
  // header
  let logoDrawn = false;
  if (logoBytes) { try { const img = await doc.embedPng(logoBytes); const sc = img.scale(46 / img.height); page.drawImage(img, { x: M, y: y - 46, width: sc.width, height: sc.height }); logoDrawn = true; } catch (e) { /* fall back to text */ } }
  if (!logoDrawn) { y -= 30; text('RAAHA', M, 30, B, BURG); y += 30; }
  rtext('Quote', R, 22, F, BURG);
  y -= 16; rtext(q.quote_number + (q.version > 1 ? ' · revision ' + q.version : ''), R, 10);
  y -= 13; rtext('Prepared ' + fmtDate(q.sent_on || todayChicago(), false), R, 10);
  if (q.valid_until) { y -= 13; rtext('Valid until ' + fmtDate(q.valid_until, false), R, 10); }
  y = H - M - 62; text('RAAHA SOUL HOUSE · COFFEE CART', M, 8.5, F, BURG);
  y -= 10; page.drawLine({ start: { x: M, y }, end: { x: R, y }, thickness: 1.5, color: BURG });
  // prepared for
  heading('Prepared for');
  for (const l of [inq.name, inq.email, inq.phone].filter(Boolean)) { text(l, M, 11); y -= 14; }
  // event
  const ev = [['Event', inq.event_type], ['Date', fmtDate(inq.event_date, false)], ['Time', timeRange(inq)], ['Location', place(inq)],
    ['Guests', q.guest_count || inq.guest_count], ['Service', q.service_duration || inq.service_duration]].filter((p) => p[1]);
  if (ev.length) {
    heading('Event');
    const colW = (R - M) / 3;
    for (let i = 0; i < ev.length; i += 3) {
      const row = ev.slice(i, i + 3);
      const wrapped = row.map((p) => wrap(F, 11, String(p[1]), colW - 12));
      const h = 12 + 13 * Math.max(...wrapped.map((w) => w.length));
      ensure(h + 6);
      row.forEach((p, j) => {
        const x = M + j * colW, y0 = y;
        page.drawText(p[0].toUpperCase(), { x, y: y0, size: 7.5, font: F, color: MUTED });
        wrapped[j].forEach((l, k) => page.drawText(l, { x, y: y0 - 12 - 13 * k, size: 11, font: F, color: INK }));
      });
      y -= h + 6;
    }
    y += 6;
  }
  if (q.beverages && q.beverages.length) {
    heading('Beverage selection');
    for (const l of wrap(F, 11, q.beverages.join(' · '), R - M)) { ensure(14); text(l, M, 11); y -= 14; }
  }
  // charges
  heading('Quote');
  const cQty = R - 190, cUnit = R - 95, descW = cQty - M - 40;
  const header = () => { text('DESCRIPTION', M + 2, 7.5, F, MUTED); rtext('QTY', cQty, 7.5, F, MUTED); rtext('UNIT PRICE', cUnit, 7.5, F, MUTED); rtext('AMOUNT', R - 2, 7.5, F, MUTED); y -= 6; page.drawLine({ start: { x: M, y }, end: { x: R, y }, thickness: 0.8, color: GOLD }); y -= 14; };
  header();
  for (const li of (q.line_items || [])) {
    const lines = wrap(F, 11, li.desc || '', descW);
    const h = 13 * lines.length + 8;
    if (y - h < 64) { newPage(); header(); }
    lines.forEach((l, k) => page.drawText(l, { x: M + 2, y: y - 13 * k, size: 11, font: F, color: INK }));
    rtext(String(li.qty), cQty, 11); rtext(money(li.unit_price), cUnit, 11); rtext(money(Math.round(Number(li.qty || 0) * Number(li.unit_price || 0) * 100) / 100), R - 2, 11);
    y -= 13 * (lines.length - 1) + 8; page.drawLine({ start: { x: M, y }, end: { x: R, y }, thickness: 0.5, color: RULE }); y -= 14;
  }
  ensure(80);
  const tot = (label, val, bold) => { text(label, R - 200, bold ? 13 : 11, bold ? B : F); rtext(val, R - 2, bold ? 13 : 11, bold ? B : F); y -= bold ? 18 : 15; };
  tot('Subtotal', money(q.subtotal));
  if (Number(q.travel_fee)) tot('Travel fee', money(q.travel_fee));
  if (Number(q.discount)) tot('Discount', '-' + money(q.discount));
  page.drawLine({ start: { x: R - 204, y: y + 7 }, end: { x: R, y: y + 7 }, thickness: 1.2, color: BURG }); y -= 12;
  tot('Total', money(q.total), true);
  if (q.client_notes) { heading('Notes'); for (const l of wrap(F, 11, q.client_notes, R - M)) { ensure(14); text(l, M, 11); y -= 14; } }
  if (Number(inq.deposit_amount) > 0) {
    ensure(40); y -= 14;
    for (const l of wrap(F, 11, 'Deposit to reserve your date: ' + money(inq.deposit_amount) + (inq.deposit_due_on ? ' by ' + fmtDate(inq.deposit_due_on, false) : '') + '. Your date is confirmed once the deposit is received.', R - M)) { text(l, M, 11); y -= 14; }
  }
  ensure(30); y -= 10;
  for (const l of wrap(F, 9.5, 'This is a custom quote prepared for your event. To accept, reply to the email this quote came with.', R - M)) { text(l, M, 9.5, F, MUTED); y -= 12; }
  return await doc.save();
}
export function b64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}

// ---------- sending with an email log (duplicate-proof) ----------
const SENT = ['accepted', 'delivered', 'delayed'];
export async function sendLogged(deps, o) {
  const { svc, env } = deps;
  const get = async () => (await svc.from('email_log').select('*').eq('idempotency_key', o.key).maybeSingle()).data;
  let row = await get();
  if (row && SENT.includes(row.status)) return { ok: true, duplicate: true, log: row };
  if (!row) {
    const ins = await svc.from('email_log').insert({ kind: o.kind, inquiry_id: o.inquiry_id || null, quote_id: o.quote_id || null, idempotency_key: o.key,
      to_email: o.to, subject: o.subject, body_text: (o.text || '').slice(0, 20000), status: 'pending', attempts: 0, created_by: o.created_by || null }).select().single();
    if (ins.error) {
      row = await get();               // another request created it a moment ago
      if (!row) return { ok: false, error: 'Could not record the email: ' + ins.error.message };
      if (SENT.includes(row.status)) return { ok: true, duplicate: true, log: row };
      if (row.status === 'pending') return { ok: false, inProgress: true, error: 'This email is already being sent. Refresh in a moment.', log: row };
    } else row = ins.data;
  }
  // a "pending" row has an unknown outcome: reuse its attempt key so Resend recognises a repeat (no duplicate)
  const attempt = row.status === 'pending' ? Math.max(row.attempts, 1) : row.attempts + 1;
  const upd = async (fields) => { const r = await svc.from('email_log').update(Object.assign({ updated_at: new Date().toISOString(), attempts: attempt }, fields)).eq('id', row.id).select().single(); return r.data || Object.assign({}, row, fields); };
  if (!env.RESEND_API_KEY) {
    const log = await upd({ status: 'failed', error: 'Email sending is not set up yet: the Resend key has not been added to Supabase.' });
    return { ok: false, error: log.error, log };
  }
  let res, json = {};
  try {
    res = await deps.fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': (o.key + '#' + attempt).slice(0, 256) },
      body: JSON.stringify({ from: FROM, to: [o.to], reply_to: REPLY_TO, subject: o.subject, html: o.html, text: o.text,
        attachments: o.attachments || undefined, tags: [{ name: 'kind', value: o.kind }] })
    });
    try { json = await res.json(); } catch (e) { json = {}; }
  } catch (e) {
    const log = await upd({ status: 'pending', error: 'No answer from the email provider (' + String(e && e.message || e).slice(0, 200) + '). Retry is safe.' });
    return { ok: false, error: log.error, log };
  }
  if (res.ok && json.id) {
    const log = await upd({ status: 'accepted', provider_id: json.id, error: null });
    return { ok: true, log };
  }
  const msg = (json && (json.message || json.name)) || ('HTTP ' + res.status);
  if (res.status === 409 && /concurrent|progress/i.test(msg)) {
    const log = await upd({ status: 'pending', error: 'Provider is still processing this email. Retry in a moment.' });
    return { ok: false, inProgress: true, error: log.error, log };
  }
  const log = await upd({ status: 'failed', error: ('Not sent: ' + msg).slice(0, 1000) });
  return { ok: false, error: log.error, log };
}

// ---------- Resend webhook signature (Svix) ----------
function fromB64(s) { if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64')); const b = atob(s); return Uint8Array.from(b, (c) => c.charCodeAt(0)); }
export async function verifySvix(secret, id, ts, sigHeader, body, nowSec = Math.floor(Date.now() / 1000)) {
  if (!secret || !id || !ts || !sigHeader) return false;
  if (Math.abs(nowSec - Number(ts)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', fromB64(secret.replace(/^whsec_/, '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(id + '.' + ts + '.' + body)));
  const expected = b64(mac);
  return sigHeader.split(' ').some((part) => { const v = part.split(',')[1]; return v && v.length === expected.length && v === expected; });
}
const RANK = { pending: 0, accepted: 1, delayed: 2, delivered: 3, bounced: 4, failed: 4, complained: 4 };
const EVENT_STATUS = { 'email.sent': 'accepted', 'email.delivered': 'delivered', 'email.delivery_delayed': 'delayed', 'email.bounced': 'bounced', 'email.complained': 'complained', 'email.failed': 'failed' };

// ---------- helpers ----------
function corsHeaders(req) {
  const o = req.headers.get('origin') || '';
  return { 'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0], 'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
}
function json(req, status, body) { return new Response(JSON.stringify(body), { status, headers: Object.assign({ 'Content-Type': 'application/json' }, corsHeaders(req)) }); }
async function one(svc, table, id) { const r = await svc.from(table).select('*').eq('id', id).maybeSingle(); return r.data || null; }
async function acceptedQuote(svc, inquiryId) {
  const r = await svc.from('booking_quotes').select('*').eq('inquiry_id', inquiryId).eq('status', 'accepted').order('version', { ascending: false }).limit(1);
  return (r.data && r.data[0]) || null;
}
async function requireAdmin(req, svc) {
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  const u = await svc.auth.getUser(jwt);
  const user = u && u.data && u.data.user;
  if (!user || !user.email || !user.email_confirmed_at) return null;
  const a = await svc.from('admin_users').select('email').eq('email', user.email.toLowerCase()).maybeSingle();
  return a.data ? user : null;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- actions ----------
async function sendQuote(deps, quoteId, note, user) {
  const { svc } = deps;
  const q = await one(svc, 'booking_quotes', quoteId);
  if (!q) return { ok: false, error: 'Quote not found.' };
  const inq = await one(svc, 'inquiries', q.inquiry_id);
  if (!inq || !inq.email) return { ok: false, error: 'This booking has no customer email address.' };
  const key = 'quote:' + q.id;
  if (q.status !== 'draft') {
    const prior = (await svc.from('email_log').select('*').eq('idempotency_key', key).maybeSingle()).data;
    if (q.status === 'sent' && prior && SENT.includes(prior.status)) return { ok: true, duplicate: true, log: prior, quote: q };
    if (q.status !== 'sent') return { ok: false, error: 'Only a draft quote can be sent (this one is ' + q.status + ').' };
  }
  if (!(Number(q.total) > 0) || !(q.line_items || []).length) return { ok: false, error: 'Add priced lines before sending — the total is $0.' };
  let logo = null; try { logo = await deps.getLogo(); } catch (e) { logo = null; }
  const pdf = await buildQuotePdf(deps.PDFLib, logo, Object.assign({}, q, { sent_on: q.sent_on || todayChicago() }), inq);
  const m = quoteEmail(inq, q, note);
  const r = await sendLogged(deps, { kind: 'quote', inquiry_id: inq.id, quote_id: q.id, key, to: inq.email, subject: m.subject, html: m.html, text: m.text,
    attachments: [{ filename: q.quote_number + (q.version > 1 ? '-rev' + q.version : '') + '.pdf', content: b64(pdf) }], created_by: user && user.id });
  if (!r.ok) return r;
  // only after the provider accepted the email: mark this exact version Sent
  const today = todayChicago();
  if (q.status === 'draft') {
    await svc.from('booking_quotes').update({ status: 'sent', sent_on: today }).eq('id', q.id).eq('status', 'draft');
    await svc.from('booking_quotes').update({ status: 'superseded' }).eq('inquiry_id', q.inquiry_id).lt('version', q.version).in('status', ['draft', 'sent']);
  }
  if (['new', 'contacted'].includes(inq.status)) await svc.from('inquiries').update({ status: 'quoted' }).eq('id', inq.id);
  return Object.assign({}, r, { quote: await one(svc, 'booking_quotes', q.id) });
}
async function sendConfirmation(deps, inquiryId, user) {
  const { svc } = deps;
  const inq = await one(svc, 'inquiries', inquiryId);
  if (!inq) return { ok: false, error: 'Booking not found.' };
  if (inq.status !== 'confirmed') return { ok: false, error: 'The booking is not confirmed, so no confirmation email was sent.' };
  if (!inq.email) return { ok: false, error: 'This booking has no customer email address.' };
  const q = await acceptedQuote(svc, inq.id);
  const m = confirmationEmail(inq, q);
  return sendLogged(deps, { kind: 'confirmation', inquiry_id: inq.id, quote_id: q && q.id, key: 'confirm:' + inq.id, to: inq.email, subject: m.subject, html: m.html, text: m.text, created_by: user && user.id });
}
async function sendAck(deps, inquiryId) {
  const { svc } = deps;
  const inq = await one(svc, 'inquiries', inquiryId);
  if (!inq || !inq.email) return { ok: false, skipped: 'no inquiry' };
  if (inq.is_test) return { ok: false, skipped: 'test inquiry' };
  const m = ackEmail(inq);
  return sendLogged(deps, { kind: 'ack', inquiry_id: inq.id, key: 'ack:' + inq.id, to: inq.email, subject: m.subject, html: m.html, text: m.text });
}

export async function handleAdmin(req, deps, body) {
  const user = await requireAdmin(req, deps.svc);
  if (!user) return json(req, 401, { ok: false, error: 'Please sign in to RAAHA Admin again.' });
  const { svc, env } = deps;
  const a = body.action;
  if (a === 'status') {
    const s = (await svc.from('site_settings').select('auto_ack_enabled').eq('id', true).maybeSingle()).data || {};
    return json(req, 200, { ok: true, configured: !!env.RESEND_API_KEY, webhook: !!env.RESEND_WEBHOOK_SECRET, auto_ack: !!s.auto_ack_enabled, from: FROM, reply_to: REPLY_TO });
  }
  if (a === 'preview') {
    const sample = { name: 'Maya Example', email: 'customer@example.com', inquiry_type: 'coffee_cart', event_type: 'Wedding', event_date: '2026-12-19', guest_count: 75,
      city_neighborhood: 'The Heights', service_duration: '3 hours', event_start_time: '14:00', event_end_time: '17:00', deposit_amount: 300, deposit_received_on: '2026-11-04', balance_amount: 650, balance_due_on: '2026-12-12' };
    const sq = { quote_number: 'RAAHA-2026-0XX', version: 1, total: 950, guest_count: 75, service_duration: '3 hours', beverages: ['Latte', 'House Chai Latte'], valid_until: '2026-11-15' };
    const pick = { ack: ackEmail(sample), quote: quoteEmail(sample, sq), confirmation: confirmationEmail(sample, sq) }[body.template] || ackEmail(sample);
    return json(req, 200, { ok: true, subject: pick.subject, text: pick.text, html: pick.html });
  }
  if (a === 'reply') {
    const inq = UUID.test(body.inquiry_id || '') ? await one(svc, 'inquiries', body.inquiry_id) : null;
    if (!inq || !inq.email) return json(req, 400, { ok: false, error: 'Booking or email address not found.' });
    const subject = String(body.subject || '').trim().slice(0, 300), text = String(body.body || '').trim().slice(0, 20000);
    if (!subject || !text) return json(req, 400, { ok: false, error: 'Add a subject and a message.' });
    if (!UUID.test(body.client_key || '')) return json(req, 400, { ok: false, error: 'Missing send key.' });
    const m = replyEmail(subject, text);
    const r = await sendLogged(deps, { kind: 'reply', inquiry_id: inq.id, key: 'reply:' + body.client_key, to: inq.email, subject, html: m.html, text: m.text, created_by: user.id });
    if (r.ok && !r.duplicate && inq.status === 'new') await svc.from('inquiries').update({ status: 'contacted' }).eq('id', inq.id);
    return json(req, r.ok ? 200 : 502, r);
  }
  if (a === 'send_quote') {
    if (!UUID.test(body.quote_id || '')) return json(req, 400, { ok: false, error: 'Quote not found.' });
    const r = await sendQuote(deps, body.quote_id, body.note, user);
    return json(req, r.ok ? 200 : (r.error && /Only a draft|Add priced|no customer/.test(r.error) ? 400 : 502), r);
  }
  if (a === 'send_confirmation') {
    if (!UUID.test(body.inquiry_id || '')) return json(req, 400, { ok: false, error: 'Booking not found.' });
    const r = await sendConfirmation(deps, body.inquiry_id, user);
    return json(req, r.ok ? 200 : (r.error && /not confirmed|no customer|not found/.test(r.error) ? 400 : 502), r);
  }
  if (a === 'retry') {
    const row = UUID.test(body.email_id || '') ? await one(svc, 'email_log', body.email_id) : null;
    if (!row) return json(req, 404, { ok: false, error: 'Email not found.' });
    if (SENT.includes(row.status)) return json(req, 200, { ok: true, duplicate: true, log: row });
    let r;
    if (row.kind === 'quote') r = await sendQuote(deps, row.quote_id, null, user);
    else if (row.kind === 'confirmation') r = await sendConfirmation(deps, row.inquiry_id, user);
    else if (row.kind === 'ack') r = await sendAck(deps, row.inquiry_id);
    else { const m = replyEmail(row.subject, row.body_text || ''); r = await sendLogged(deps, { kind: 'reply', inquiry_id: row.inquiry_id, key: row.idempotency_key, to: row.to_email, subject: row.subject, html: m.html, text: m.text, created_by: user.id }); }
    return json(req, r.ok ? 200 : 502, r);
  }
  return json(req, 400, { ok: false, error: 'Unknown action.' });
}

export async function handleAck(req, deps, body) {
  if (!UUID.test(body.inquiry_id || '')) return json(req, 400, { ok: false });
  const { svc } = deps;
  const s = (await svc.from('site_settings').select('auto_ack_enabled').eq('id', true).maybeSingle()).data;
  if (!s || !s.auto_ack_enabled) return json(req, 200, { ok: false, skipped: 'auto-acknowledgment is off' });
  const inq = await one(svc, 'inquiries', body.inquiry_id);
  if (!inq) return json(req, 404, { ok: false });
  if (Date.now() - new Date(inq.created_at).getTime() > 60 * 60 * 1000) return json(req, 200, { ok: false, skipped: 'not a new inquiry' });
  const r = await sendAck(deps, inq.id);
  return json(req, 200, { ok: !!r.ok, skipped: r.skipped || undefined, duplicate: r.duplicate || undefined });
}

export async function handleWebhook(req, deps, raw) {
  const ok = await verifySvix(deps.env.RESEND_WEBHOOK_SECRET, req.headers.get('svix-id'), req.headers.get('svix-timestamp'), req.headers.get('svix-signature'), raw);
  if (!ok) return new Response('invalid signature', { status: 401 });
  let ev; try { ev = JSON.parse(raw); } catch (e) { return new Response('bad json', { status: 400 }); }
  const status = EVENT_STATUS[ev.type], id = ev.data && ev.data.email_id;
  if (!status || !id) return new Response('ignored', { status: 200 });
  const { svc } = deps;
  const row = (await svc.from('email_log').select('*').eq('provider_id', id).maybeSingle()).data;
  if (!row) return new Response('unknown email', { status: 200 });
  if (RANK[status] >= RANK[row.status] || RANK[status] === 4) {
    const err = status === 'bounced' || status === 'failed' || status === 'complained'
      ? ('Provider reported ' + status + (ev.data.bounce && ev.data.bounce.message ? ': ' + ev.data.bounce.message : '')).slice(0, 1000) : row.error;
    await svc.from('email_log').update({ status, last_event_at: new Date().toISOString(), updated_at: new Date().toISOString(), error: err }).eq('id', row.id);
  }
  return new Response('ok', { status: 200 });
}

export async function route(req, deps) {
  const path = new URL(req.url).pathname;
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, 405, { ok: false });
  try {
    if (path.endsWith('/webhook')) return await handleWebhook(req, deps, await req.text());
    const body = await req.json().catch(() => ({}));
    if (path.endsWith('/ack')) return await handleAck(req, deps, body);
    return await handleAdmin(req, deps, body);
  } catch (e) {
    console.error('raaha-email error', e);
    return json(req, 500, { ok: false, error: 'Unexpected error: ' + String(e && e.message || e).slice(0, 300) });
  }
}
