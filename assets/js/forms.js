/*
 * RAAHA forms: submit to the existing Formspree endpoints without leaving the page.
 * If anything goes wrong (no network, Formspree rejects in-page submission),
 * the form falls back to a normal submit, which is exactly how it worked before.
 */
(function () {
  var MESSAGES = {
    'Coffee Cart Booking Inquiry': 'Thank you — your Coffee Cart request has been received. We will be in touch to confirm availability, menu, and pricing.',
    'Event Inquiry': 'Thank you — your gathering inquiry has been received. We will be in touch soon.',
    'Career Application': 'Thank you for your interest in joining RAAHA. We have received your application.',
    'General Contact Form Inquiry': 'Thank you — your message has been received. We will reply soon.'
  };
  var DEFAULT_MESSAGE = 'Thank you — you are on the list.';

  function statusBox(form) {
    var box = form.querySelector('.form-status');
    if (!box) {
      box = document.createElement('div');
      box.className = 'form-status';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      form.appendChild(box);
    }
    return box;
  }

  function fallback(form) {
    form.dataset.native = '1';
    form.submit();
  }

  document.querySelectorAll('form[action^="https://formspree.io/"]').forEach(function (form) {
    form.addEventListener('submit', function (event) {
      if (form.dataset.native === '1') return; // fallback path: let the browser submit
      event.preventDefault();

      // Optional hook (used by the Coffee Cart form to also save the inquiry to RAAHA's records)
      if (typeof window.raahaBeforeFormspree === 'function') {
        try { window.raahaBeforeFormspree(form); } catch (e) { /* never block the email path */ }
      }

      var button = form.querySelector('button[type="submit"]');
      var label = button ? button.textContent : '';
      if (button) { button.disabled = true; button.textContent = 'Sending…'; }

      fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { Accept: 'application/json' }
      }).then(function (response) {
        if (!response.ok) throw new Error('Formspree ' + response.status);
        var typeField = form.querySelector('input[name="form_type"]');
        var type = typeField ? typeField.value : '';
        var box = statusBox(form);
        box.className = 'form-status is-success';
        box.textContent = MESSAGES[type] || DEFAULT_MESSAGE;
        form.reset();
        if (button) { button.disabled = false; button.textContent = label; }
        box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }).catch(function () {
        if (button) { button.disabled = false; button.textContent = label; }
        fallback(form);
      });
    });
  });
})();
