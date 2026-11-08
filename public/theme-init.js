// Aplica el tema antes de pintar para evitar parpadeos. Es una preferencia de este dispositivo.
(function () {
  try {
    var pref = localStorage.getItem('conqr:theme') || 'system';
    var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#161514' : '#F6F3EE');
  } catch (e) {
    document.documentElement.dataset.theme = 'light';
  }
})();
