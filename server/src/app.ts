import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './env.js';
import { errorHandler } from './lib/http.js';
import { isAllowedOrigin } from './lib/origins.js';
import { requireAuth } from './auth/middleware.js';
import { authRouter } from './routes/auth.js';
import { meRouter } from './routes/me.js';
import { dashboardRouter } from './routes/dashboard.js';
import { classesRouter, toolsRouter } from './routes/classes.js';
import { assignmentsRouter, questionsRouter } from './routes/assignments.js';
import { flagsRouter, submissionsRouter } from './routes/submissions.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https://*.googleusercontent.com'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          scriptSrc: ["'self'"],
          workerSrc: ["'self'", 'blob:'],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
      credentials: false,
      exposedHeaders: ['Content-Disposition'],
    }),
  );
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  const apiLimiter = rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false });
  app.use('/api', apiLimiter);

  app.use('/api/auth', authRouter);
  app.use('/api/me', requireAuth, meRouter);
  app.use('/api', requireAuth, dashboardRouter);
  app.use('/api/classes', requireAuth, classesRouter);
  app.use('/api/tools', requireAuth, toolsRouter);
  app.use('/api/assignments', requireAuth, assignmentsRouter);
  app.use('/api/questions', requireAuth, questionsRouter);
  app.use('/api/submissions', requireAuth, submissionsRouter);
  app.use('/api/flags', requireAuth, flagsRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }));

  // Serve the built web app (PC / browser version) from the same server.
  const webDir = env.SERVE_WEB_DIR ? path.resolve(env.SERVE_WEB_DIR) : path.resolve(here, '../../app/dist');
  if (fs.existsSync(path.join(webDir, 'index.html'))) {
    app.use(
      express.static(webDir, {
        index: false,
        setHeaders: (res, file) => {
          if (/\/assets\//.test(file)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          else res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(webDir, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
