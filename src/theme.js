export const themeModes = ['system', 'light', 'dark'];
export function readThemePreference(storage = localStorage) {
  try { const value = storage.getItem('fnosThemeMode'); return themeModes.includes(value) ? value : 'system'; }
  catch { return 'system'; }
}
export function isDarkTheme(mode, prefersDark) { return mode === 'system' ? Boolean(prefersDark) : mode === 'dark'; }
export function applyDocumentTheme(mode, prefersDark) {
  const dark = isDarkTheme(mode, prefersDark);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  return dark;
}
