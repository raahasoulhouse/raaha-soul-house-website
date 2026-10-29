/*
 * Saves Coffee Cart and gathering inquiries to RAAHA's private records (Supabase)
 * alongside the existing Formspree email. If saving fails, the email still goes out.
 */
(function () {
  var cfg = window.RAAHA_CONFIG;
  if (!cfg) return;

  // Remember where the visitor came from (first touch in this browser session)
  try {
    if (!sessionStorage.getItem('raaha_src')) {
      var q = new URLSearchParams(location.search);
      sessionStorage.setItem('raaha_src', JSON.stringify({
        utm_source: q.get('utm_source'),
        utm_medium: q.get('utm_medium'),
        utm_campaign: q.get('utm_campaign'),
        referrer: document.referrer || null,
        landing_page: location.pathname + location.search
      }));
    }
  } catch (e) { /* storage unavailable: carry on without attribution */ }

  function source() {
    try { return JSON.parse(sessionStorage.getItem('raaha_src')) || {}; } catch (e) { return {}; }
  }

  function val(form, name) {
    var el = form.elements[name];
    if (!el) return null;
    var v = (el.value || '').trim();
    return v === '' ? null : v;
  }

  function clip(v, n) { return v == null ? null : String(v).slice(0, n); }

  var TYPES = { 'Coffee Cart Booking Inquiry': 'coffee_cart', 'Event Inquiry': 'gathering' };

  window.raahaBeforeFormspree = function (form) {
    var type = TYPES[val(form, 'form_type')];
    if (!type) return; // only booking-type forms are stored

    var src = source();
    var guests = parseInt(val(form, 'number_of_guests'), 10);
    var row = {
      inquiry_type: type,
      name: clip(val(form, 'name'), 120),
      email: clip(val(form, 'email'), 200),
      phone: clip(val(form, 'phone'), 40),
      event_type: clip(val(form, 'event_type'), 80),
      event_date: val(form, 'preferred_date'),
      guest_count: isNaN(guests) ? null : guests,
      service_duration: clip(val(form, 'service_duration'), 80),
      city_neighborhood: clip(val(form, 'city_neighborhood'), 120),
      venue_address: clip(val(form, 'venue_address'), 240),
      message: clip(val(form, 'message'), 4000),
      heard_about: clip(val(form, 'heard_about'), 80),
      utm_source: clip(src.utm_source, 120),
      utm_medium: clip(src.utm_medium, 120),
      utm_campaign: clip(src.utm_campaign, 120),
      referrer: clip(src.referrer, 500),
      landing_page: clip(src.landing_page, 500),
      // anything submitted outside the live domain (previews, local testing) is marked as a test
      is_test: cfg.productionHosts.indexOf(location.hostname) === -1
    };

    fetch(cfg.supabaseUrl + '/rest/v1/inquiries', {
      method: 'POST',
      keepalive: true,
      headers: {
        apikey: cfg.supabasePublishableKey,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(row)
    }).then(function (res) {
      if (!res.ok) return res.text().then(function (t) { console.warn('RAAHA inquiry not saved:', res.status, t); });
    }).catch(function (err) {
      console.warn('RAAHA inquiry not saved:', err);
    });
  };
})();
