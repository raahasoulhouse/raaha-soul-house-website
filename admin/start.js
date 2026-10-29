/* RAAHA admin — sign-in and start-up. Runs last. */
(function () {
  'use strict';
  var A = window.RAAHA_ADMIN, $ = A.$, db = A.db, cfg = A.cfg;
  var started = false;

  function show(view) {
    $('login-view').hidden = view !== 'login';
    $('app-view').hidden = view !== 'app';
    $('sign-out').hidden = view !== 'app';
    $('view-site').hidden = view !== 'app';
  }

  function start() {
    show('app');
    if (started) return;
    started = true;
    Promise.all([A.content.load(), A.media.load()].concat(
      A.modules.filter(function (m) { return m.start && m.tab !== 'media'; }).map(function (m) { return m.start(); })
    )).catch(function (e) {
      A.toast('Some admin data could not load: ' + (e.message || e) + '. Is this account on the admin list?', true);
    }).then(function () {
      var tab = 'bookings';
      try { tab = sessionStorage.getItem('raaha-admin-tab') || tab; } catch (e) {}
      if (!document.querySelector('.tabs [data-tab="' + tab + '"]')) tab = 'bookings';
      A.showTab(tab);
    });
  }

  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    $('login-msg').textContent = 'Signing in…';
    db.auth.signInWithPassword({ email: $('login-email').value.trim(), password: $('login-password').value }).then(function (res) {
      $('login-password').value = '';
      if (res.error) { $('login-msg').textContent = 'Sign-in failed: check the email and password.'; return; }
      $('login-msg').textContent = '';
      start();
    });
  });
  $('sign-out').addEventListener('click', function () {
    db.auth.signOut().then(function () { location.reload(); });
  });

  if (cfg.productionHosts.indexOf(location.hostname) === -1) {
    $('env-badge').hidden = false;
    $('env-badge').textContent = 'Preview';
  }
  db.auth.getSession().then(function (res) {
    if (res.data && res.data.session) start(); else show('login');
  });
})();
