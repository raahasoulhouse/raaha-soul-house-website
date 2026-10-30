/* RAAHA site chrome: mobile menu, preview label, Coffee Cart sticky button. */
(function () {
  'use strict';
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('primary-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.textContent = open ? 'Close' : 'Menu';
    });
  }
  var hosts = ['www.raahasoulhouse.com', 'raahasoulhouse.com'];
  var notice = document.getElementById('preview-notice');
  if (notice && hosts.indexOf(location.hostname) === -1) notice.hidden = false;

  // Hide the floating "Book" button while the booking form is on screen
  // (and while the page header with its own booking button is visible)
  var sticky = document.getElementById('sticky-book');
  var watch = [document.querySelector('.page-hero-photo'), document.getElementById('book')].filter(Boolean);
  if (sticky && watch.length && 'IntersectionObserver' in window) {
    var visible = {};
    sticky.classList.add('is-hidden');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { visible[e.target.className] = e.isIntersecting; });
      sticky.classList.toggle('is-hidden', Object.keys(visible).some(function (k) { return visible[k]; }));
    }, { threshold: 0.05 });
    watch.forEach(function (el) { io.observe(el); });
  }
})();
