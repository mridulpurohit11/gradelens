// Applies the saved theme before first paint (kept external for the Content Security Policy).
try {
  var t = localStorage.getItem('gl.theme') || 'SYSTEM';
  var dark = t === 'DARK' || (t === 'SYSTEM' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.classList.add('dark');
} catch (e) {}
