import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { and, eq, gt, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { env } from '../env.js';
import { ah, HttpError } from '../lib/http.js';
import { encrypt, randomToken } from '../lib/crypto.js';
import { signSession, signState, verifyState } from '../lib/jwt.js';
import { buildAuthUrl, exchangeCode, type GoogleIdentity } from '../services/google.js';
import { isAllowedWebReturn } from '../lib/origins.js';

type OAuthState = { p: 'web' | 'native'; s?: string; r?: string; c?: boolean };

export const authRouter = Router();

const limiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false });
authRouter.use(limiter);

authRouter.get('/config', (_req, res) => {
  res.json({
    googleConfigured: env.googleConfigured,
    devLogin: env.devLoginEnabled,
    aiConfigured: env.aiConfigured,
    allowedDomains: env.allowedDomains,
  });
});

/** Step 1: send the browser to Google. */
authRouter.get(
  '/google/start',
  ah(async (req, res) => {
    const platform = req.query.platform === 'native' ? 'native' : 'web';
    const consent = req.query.consent === '1';
    const state: OAuthState = { p: platform, c: consent };
    if (platform === 'native') {
      const session = String(req.query.session ?? '');
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(session)) throw new HttpError(400, 'Invalid login session');
      await db
        .insert(schema.authHandoffs)
        .values({ id: session, expiresAt: new Date(Date.now() + 10 * 60_000) })
        .onConflictDoNothing();
      state.s = session;
    } else {
      const ret = typeof req.query.return === 'string' ? req.query.return : '';
      if (ret && isAllowedWebReturn(ret)) state.r = ret.replace(/\/$/, '');
    }
    res.redirect(buildAuthUrl(signState(state), consent));
  }),
);

async function upsertTeacher(identity: GoogleIdentity) {
  const existing = await db.query.teachers.findFirst({
    where: or(eq(schema.teachers.googleSub, identity.sub), eq(schema.teachers.email, identity.email)),
  });
  if (existing) {
    const [updated] = await db
      .update(schema.teachers)
      .set({
        googleSub: identity.sub,
        email: identity.email,
        googlePicture: identity.picture ?? existing.googlePicture,
        ...(identity.refreshToken ? { googleRefreshTokenEnc: encrypt(identity.refreshToken) } : {}),
        ...(identity.scopes ? { googleScopes: identity.scopes } : {}),
      })
      .where(eq(schema.teachers.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(schema.teachers)
    .values({
      googleSub: identity.sub,
      email: identity.email,
      name: identity.name,
      googlePicture: identity.picture,
      googleRefreshTokenEnc: identity.refreshToken ? encrypt(identity.refreshToken) : null,
      googleScopes: identity.scopes ?? null,
    })
    .returning();
  return created;
}

function nativeResultPage(ok: boolean, message: string) {
  const color = ok ? '#2E7D32' : '#C62828';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GradeLens</title><style>body{margin:0;font-family:Inter,system-ui,sans-serif;background:#F7F8FA;color:#1A1D23;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}
.card{background:#fff;border:1px solid #E1E5EB;border-radius:12px;padding:32px 24px;max-width:380px;text-align:center}
.logo{width:56px;height:56px;border-radius:12px;background:#1E3A5F;color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:20px}
h1{font-size:20px;margin:0 0 8px;color:${color}}p{color:#5F6B7A;font-size:14px;line-height:20px;margin:0}</style></head>
<body><div class="card"><div class="logo">GL</div><h1>${ok ? 'Signed in' : 'Sign-in failed'}</h1><p>${message}</p></div></body></html>`;
}

/** Step 2: Google redirects back here. */
authRouter.get(
  '/google/callback',
  ah(async (req, res) => {
    let state: OAuthState;
    try {
      state = verifyState<OAuthState>(String(req.query.state ?? ''));
    } catch {
      return res.status(400).send(nativeResultPage(false, 'This sign-in link has expired. Please try again from the app.'));
    }
    const webBase = state.r ?? env.FRONTEND_URL.replace(/\/$/, '');

    const fail = async (message: string) => {
      if (state.p === 'native' && state.s) {
        await db.update(schema.authHandoffs).set({ error: message }).where(eq(schema.authHandoffs.id, state.s));
        return res.status(400).send(nativeResultPage(false, `${message} You can close this window and return to GradeLens.`));
      }
      return res.redirect(`${webBase}/login?error=${encodeURIComponent(message)}`);
    };

    if (req.query.error) {
      return fail(req.query.error === 'access_denied' ? 'Google sign-in was cancelled.' : 'Google sign-in failed.');
    }
    const code = String(req.query.code ?? '');
    if (!code) return fail('Google sign-in failed.');

    let identity: GoogleIdentity;
    try {
      identity = await exchangeCode(code);
    } catch (err) {
      console.error('[auth] code exchange failed', err);
      return fail('Google sign-in failed. Please try again.');
    }

    const domain = identity.email.split('@')[1] ?? '';
    if (env.allowedDomains.length && !env.allowedDomains.includes(domain)) {
      return fail(`Please sign in with your institutional account (${env.allowedDomains.map((d) => '@' + d).join(', ')}).`);
    }

    const teacher = await upsertTeacher(identity);

    // Without a refresh token GradeLens cannot read Drive in the background: ask Google for consent once.
    if (!teacher.googleRefreshTokenEnc && !state.c) {
      const retry: OAuthState = { ...state, c: true };
      return res.redirect(buildAuthUrl(signState(retry), true));
    }

    const token = signSession(teacher.id, teacher.email);

    if (state.p === 'native' && state.s) {
      await db
        .update(schema.authHandoffs)
        .set({ token, teacherId: teacher.id })
        .where(eq(schema.authHandoffs.id, state.s));
      return res.send(nativeResultPage(true, 'You are signed in. Return to the GradeLens app to continue.'));
    }

    const handoff = randomToken(32);
    await db.insert(schema.authHandoffs).values({
      id: handoff,
      teacherId: teacher.id,
      token,
      expiresAt: new Date(Date.now() + 2 * 60_000),
    });
    return res.redirect(`${webBase}/auth/callback?code=${encodeURIComponent(handoff)}`);
  }),
);

/** Web: trade the one-time code for a session token. */
authRouter.post(
  '/exchange',
  ah(async (req, res) => {
    const { code } = z.object({ code: z.string().min(16).max(200) }).parse(req.body);
    const [row] = await db
      .update(schema.authHandoffs)
      .set({ used: true })
      .where(and(eq(schema.authHandoffs.id, code), eq(schema.authHandoffs.used, false), gt(schema.authHandoffs.expiresAt, new Date())))
      .returning();
    if (!row?.token) throw new HttpError(400, 'This sign-in link has expired. Please sign in again.', 'HANDOFF_INVALID');
    res.json({ token: row.token });
  }),
);

/** Native: the app polls this while the user signs in inside the system browser. */
authRouter.get(
  '/session/:id',
  ah(async (req, res) => {
    const id = req.params.id;
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(id)) throw new HttpError(400, 'Invalid session');
    const row = await db.query.authHandoffs.findFirst({ where: eq(schema.authHandoffs.id, id) });
    if (!row || row.expiresAt < new Date() || row.used) return res.json({ status: 'expired' });
    if (row.error) return res.json({ status: 'error', error: row.error });
    if (!row.token) return res.json({ status: 'pending' });
    await db.update(schema.authHandoffs).set({ used: true }).where(eq(schema.authHandoffs.id, id));
    // Opportunistic cleanup of stale rows.
    db.delete(schema.authHandoffs).where(lt(schema.authHandoffs.expiresAt, new Date())).catch(() => undefined);
    return res.json({ status: 'done', token: row.token });
  }),
);

/** Local development only: sign in without Google (never enabled in production). */
authRouter.post(
  '/dev-login',
  ah(async (req, res) => {
    if (!env.devLoginEnabled) throw new HttpError(404, 'Not found');
    const { email, name } = z
      .object({ email: z.string().email().default('demo.teacher@example.edu'), name: z.string().default('Demo Teacher') })
      .parse(req.body ?? {});
    const teacher = await upsertTeacher({ sub: `dev:${email}`, email: email.toLowerCase(), name });
    res.json({ token: signSession(teacher.id, teacher.email) });
  }),
);
