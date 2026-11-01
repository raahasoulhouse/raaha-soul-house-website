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
    $('side-toggle').hidden = view !== 'app';
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
      var tab = A.tabFromHash();
      if (!tab) { try { tab = sessionStorage.getItem('raaha-admin-tab'); } catch (e) {} }
      if (!tab || !A.tabExists(tab)) tab = 'overview';
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
  // ---------- forgot password ----------
  function loginPanel(which) {
    $('login-form').hidden = which !== 'login';
    $('forgot-form').hidden = which !== 'forgot';
    $('reset-form').hidden = which !== 'reset';
    var h = document.querySelector('#login-view > h1');
    if (h) h.textContent = which === 'forgot' ? 'Reset password' : which === 'reset' ? 'New password' : 'Sign in';
  }
  $('forgot-open').addEventListener('click', function () {
    $('forgot-email').value = $('login-email').value; $('forgot-msg').textContent = ''; loginPanel('forgot'); $('forgot-email').focus();
  });
  $('forgot-back').addEventListener('click', function () { loginPanel('login'); });
  $('forgot-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('forgot-form').querySelector('button[type=submit]');
    btn.disabled = true; $('forgot-msg').textContent = 'Sending…';
    db.auth.resetPasswordForEmail($('forgot-email').value.trim(), { redirectTo: location.origin + '/admin/' }).then(function (res) {
      btn.disabled = false;
      if (res.error) {
        $('forgot-msg').textContent = /rate|seconds|many/i.test(res.error.message)
          ? 'Too many requests just now. Please wait a few minutes, then try again.'
          : 'Could not send the email: ' + res.error.message;
        return;
      }
      $('forgot-msg').textContent = 'If that address is an admin account, a reset link is on its way. Open it on this device; it works once and expires after one hour.';
    });
  });
  // Arriving from the emailed link: choose a new password before anything else
  var recovering = /type=recovery/.test(A.initialHash);
  function showReset() { show('login'); loginPanel('reset'); $('reset-pass').focus(); }
  db.auth.onAuthStateChange(function (event) { if (event === 'PASSWORD_RECOVERY') { recovering = true; showReset(); } });
  $('reset-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var a = $('reset-pass').value, b = $('reset-pass2').value;
    if (a.length < 10) { $('reset-msg').textContent = 'Please use at least 10 characters.'; return; }
    if (a !== b) { $('reset-msg').textContent = 'The two passwords do not match.'; return; }
    $('reset-msg').textContent = 'Saving…';
    db.auth.updateUser({ password: a }).then(function (res) {
      $('reset-pass').value = $('reset-pass2').value = '';
      if (res.error) { $('reset-msg').textContent = 'Not saved: ' + res.error.message + ' — request a new reset link if this one has expired.'; return; }
      recovering = false;
      try { history.replaceState(null, '', location.pathname); } catch (x) {}
      A.toast('Password changed. You are signed in.');
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
    var session = res.data && res.data.session;
    if (session && recovering) { showReset(); return; }
    if (session) { start(); return; }
    show('login');
    if (/error_code=|error=access_denied/.test(A.initialHash)) {
      loginPanel('forgot');
      $('forgot-msg').textContent = 'That reset link has expired or was already used. Request a new one here.';
      try { history.replaceState(null, '', location.pathname); } catch (x) {}
    }
  });
})();
