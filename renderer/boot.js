window.__errors = [];
window.addEventListener('error', function (e) {
  window.__errors.push(String((e && e.message) || e));
});
window.addEventListener('unhandledrejection', function (e) {
  window.__errors.push('promise: ' + String((e && e.reason && e.reason.message) || (e && e.reason) || e));
});
document.addEventListener('DOMContentLoaded', function () { window.P4.boot(); });
