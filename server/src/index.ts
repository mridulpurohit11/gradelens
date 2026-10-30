import { env } from './env.js';
import { createApp } from './app.js';
import { runMigrations, pool } from './db/index.js';
import { resumeInterruptedRuns } from './services/evaluation.js';
import { pruneCache } from './services/sources.js';

async function main() {
  if (env.RUN_MIGRATIONS_ON_START) {
    await runMigrations();
    console.log('[db] migrations applied');
  }
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`GradeLens API listening on :${env.PORT}`);
    if (!env.googleConfigured) console.warn('[warn] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set — Google sign-in is disabled.');
    if (!env.aiConfigured) console.warn('[warn] ANTHROPIC_API_KEY not set — AI evaluation is disabled.');
    if (env.devLoginEnabled) console.warn('[warn] DEV_LOGIN is enabled (development only).');
  });
  await resumeInterruptedRuns();
  pruneCache().catch(() => undefined);
  setInterval(() => pruneCache().catch(() => undefined), 6 * 3600_000).unref();

  const shutdown = () => {
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Failed to start GradeLens API', err);
  process.exit(1);
});
