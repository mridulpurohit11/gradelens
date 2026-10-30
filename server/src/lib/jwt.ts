import jwt from 'jsonwebtoken';
import { env } from '../env.js';

export type SessionClaims = { sub: string; email: string };

export function signSession(teacherId: string, email: string): string {
  return jwt.sign({ sub: teacherId, email }, env.JWT_SECRET, { expiresIn: '30d', issuer: 'gradelens' });
}

export function verifySession(token: string): SessionClaims {
  return jwt.verify(token, env.JWT_SECRET, { issuer: 'gradelens' }) as SessionClaims;
}

/** Short-lived signed state for the OAuth round trip. */
export function signState(data: Record<string, unknown>): string {
  return jwt.sign(data, env.JWT_SECRET, { expiresIn: '15m', issuer: 'gradelens-oauth' });
}

export function verifyState<T>(token: string): T {
  return jwt.verify(token, env.JWT_SECRET, { issuer: 'gradelens-oauth' }) as T;
}
