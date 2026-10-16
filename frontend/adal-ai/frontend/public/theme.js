// Apply the saved theme before first paint; kept external for the site CSP.
try {
  const saved = JSON.parse(localStorage.getItem('adal.appearance') || '{}')
  const theme = saved?.theme === 'dark' ? 'dark' : 'light'
  document.documentElement.dataset.theme = theme
  if (theme === 'dark') document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#101722')
} catch { /* Light theme remains available when storage is blocked. */ }
