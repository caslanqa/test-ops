// Kayıtlı tema tercihini sayfa çizilmeden önce uygular; koyu temada açılışta beyaz
// flaş olmasın diye <head> içinde, CSS'ten önce ve senkron yüklenir. Helmet'in
// CSP'si satır içi script'e izin vermediği için ayrı dosyadır. "Sistem" tercihinde
// data-theme konmaz; CSS prefers-color-scheme ile karar verir.
(function () {
  try {
    var preference = localStorage.getItem('testops.theme');
    if (preference === 'light' || preference === 'dark') {
      document.documentElement.setAttribute('data-theme', preference);
    }
  } catch {
    // Depolama erişimi engelliyse (gizli mod, kapalı site verisi) sistem teması kullanılır.
  }
})();
