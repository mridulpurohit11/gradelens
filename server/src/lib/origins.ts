import { env } from '../env.js';

const strip = (u: string) => u.replace(/\/$/, '');

/** Origins allowed to call the API (web app, Capacitor native shells, dev server). */
export const allowedOrigins = new Set<string>(
  [
    env.FRONTEND_URL,
    env.PUBLIC_API_URL,
    ...(env.EXTRA_CORS_ORIGINS ?? '').split(','),
    'capacitor://localhost', // iOS app
    'https://localhost', // Android app
    'http://localhost', // Android app (http scheme)
    ...(env.isProd ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173']),
  ]
    .map((s) => s.trim())
    .filter(Boolean)
    .map(strip),
);

export function isAllowedOrigin(origin: string | undefined | null): boolean {
  if (!origin) return true; // same-origin / native HTTP clients
  return allowedOrigins.has(strip(origin));
}

/** Web origins a browser login may return to (excludes native shells). */
export function isAllowedWebReturn(origin: string): boolean {
  const o = strip(origin);
  return allowedOrigins.has(o) && /^https?:\/\//.test(o) && !/^https?:\/\/localhost$/.test(o);
}
