/* RAAHA admin — Settings: account, change password, backup (the backup button is wired in publishing.js). */
(function () {
  'use strict';
  var A = window.RAAHA_ADMIN, $ = A.$, db = A.db;

  function show() {
    db.auth.getUser().then(function (res) {
      $('set-email').textContent = (res.data && res.data.user && res.data.user.email) || '—';
    });
  }
  $('set-signout').addEventListener('click', function () {
    db.auth.signOut().then(function () { location.href = location.pathname; });
  });
  $('pw-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var a = $('pw-new').value, b = $('pw-new2').value, msg = $('pw-msg');
    if (a.length < 10) { msg.textContent = 'Please use at least 10 characters.'; return; }
    if (a !== b) { msg.textContent = 'The two passwords do not match.'; return; }
    msg.textContent = 'Saving…';
    db.auth.updateUser({ password: a }).then(function (res) {
      $('pw-new').value = $('pw-new2').value = '';
      if (res.error) {
        msg.textContent = /reauthenticat|nonce|recent/i.test(res.error.message)
          ? 'For security, please sign out and use “Forgot password?” to set a new password.'
          : 'Not changed: ' + res.error.message;
        return;
      }
      msg.textContent = 'Password changed.';
      A.toast('Password changed.');
    });
  });

  A.modules.push({ tab: 'settings', onShow: show });
})();
