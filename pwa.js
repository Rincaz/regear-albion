// Registra el service worker (solo funciona en https o localhost) y muestra «Instalar app» cuando el navegador lo permite.
(function () {
  'use strict';
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (err) { console.warn('[pwa] No se pudo registrar el service worker:', err); });
    });
  }
  var deferred = null;
  window.addEventListener('beforeinstallprompt', function (ev) {
    ev.preventDefault(); deferred = ev;
    var btn = document.getElementById('pwa-install');
    if (btn) btn.hidden = false;
  });
  document.addEventListener('click', function (ev) {
    if (!ev.target.closest || !ev.target.closest('#pwa-install') || !deferred) return;
    deferred.prompt();
    deferred.userChoice.finally(function () { deferred = null; var b = document.getElementById('pwa-install'); if (b) b.hidden = true; });
  });
  window.addEventListener('appinstalled', function () { var b = document.getElementById('pwa-install'); if (b) b.hidden = true; });
})();
