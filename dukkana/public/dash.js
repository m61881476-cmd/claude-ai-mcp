// Dashboard helpers: copy buttons and delete confirmations (no inline JS because of CSP).
(function () {
  'use strict';
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-copy]');
    if (!btn) return;
    var input = document.querySelector(btn.getAttribute('data-copy'));
    if (!input) return;
    var done = function () {
      var old = btn.textContent;
      btn.textContent = 'اتنسخ ✓';
      setTimeout(function () { btn.textContent = old; }, 1500);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(input.value).then(done, function () {
        input.select();
      });
    } else {
      input.select();
      try {
        document.execCommand('copy');
        done();
      } catch (err) { /* user can copy manually */ }
    }
  });

  document.addEventListener('submit', function (e) {
    var msg = e.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  });
})();
