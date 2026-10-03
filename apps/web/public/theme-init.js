// Applies the saved theme preference before the page is painted; it is loaded
// synchronously in <head>, before the CSS, so the dark theme doesn't flash white on
// load. It is a separate file because Helmet's CSP doesn't allow inline scripts. For
// the "System" preference no data-theme is set; CSS prefers-color-scheme decides.
(function () {
  try {
    var preference = localStorage.getItem('testops.theme');
    if (preference === 'light' || preference === 'dark') {
      document.documentElement.setAttribute('data-theme', preference);
    }
  } catch {
    // If storage access is blocked (private mode, site data disabled) the system theme is used.
  }
})();
