import type { Theme } from './types';
import { isNative } from './platform';

let media: MediaQueryList | null = null;
let current: Theme = 'SYSTEM';

function paint() {
  const dark = current === 'DARK' || (current === 'SYSTEM' && !!media?.matches);
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0F1720' : '#1E3A5F');
  if (isNative) {
    import('@capacitor/status-bar')
      .then(({ StatusBar, Style }) => {
        StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => undefined);
        StatusBar.setBackgroundColor({ color: dark ? '#1A2433' : '#FFFFFF' }).catch(() => undefined);
      })
      .catch(() => undefined);
  }
}

export function applyTheme(theme: Theme) {
  current = theme;
  try {
    localStorage.setItem('gl.theme', theme);
  } catch {
    /* ignore */
  }
  if (!media && typeof window !== 'undefined') {
    media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', paint);
  }
  paint();
}

export function savedTheme(): Theme {
  try {
    return (localStorage.getItem('gl.theme') as Theme) || 'SYSTEM';
  } catch {
    return 'SYSTEM';
  }
}
