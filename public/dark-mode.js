(function () {
  const STORAGE_KEY = 'privateProxy.theme';
  const toggle = document.getElementById('themeToggle');
  if (!toggle) return;

  function applyTheme(theme) {
    const isDark = theme === 'dark';
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    toggle.setAttribute('aria-pressed', String(isDark));
    toggle.textContent = isDark ? '☀️ Light mode' : '🌙 Dark mode';
  }

  let theme = 'light';
  try { theme = localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light'; } catch { /* Use light mode if storage is unavailable. */ }
  applyTheme(theme);

  toggle.addEventListener('click', () => {
    theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* Theme still applies for this page view. */ }
  });
})();
