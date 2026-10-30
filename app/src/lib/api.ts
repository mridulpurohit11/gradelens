import { isNative } from './platform';

/** Backend base URL. Empty = same origin (web app served by the backend or the Vite dev proxy). */
export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

if (isNative && !API_URL) {
  console.error('VITE_API_URL is not set: the mobile app cannot reach the backend.');
}

let token: string | null = null;
const listeners = new Set<(code: string) => void>();

export function setToken(t: string | null) {
  token = t;
}
export function getToken() {
  return token;
}
/** Subscribe to auth failures (expired session / Google re-auth needed). */
export function onAuthError(fn: (code: string) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

type Options = Omit<RequestInit, 'body'> & { body?: unknown; raw?: boolean };

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, { ...opts, headers, body });
  } catch {
    throw new ApiError('No internet connection. Check your network and try again.', 0, 'OFFLINE');
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    let code: string | undefined;
    try {
      const data = await res.json();
      msg = data.error ?? msg;
      code = data.code;
    } catch {
      /* not json */
    }
    if (res.status === 401 && (code === 'UNAUTHENTICATED' || code === 'GOOGLE_REAUTH')) {
      listeners.forEach((l) => l(code!));
    }
    throw new ApiError(msg, res.status, code);
  }
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  return (ct.includes('application/json') ? res.json() : res.blob()) as Promise<T>;
}

/** Fetches a protected binary (image / file) as a Blob. */
export async function apiBlob(path: string): Promise<{ blob: Blob; filename: string | null }> {
  const res = await api<Response>(path, { raw: true });
  const cd = res.headers.get('content-disposition') ?? '';
  const m = cd.match(/filename="?([^";]+)"?/);
  return { blob: await res.blob(), filename: m?.[1] ?? null };
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
