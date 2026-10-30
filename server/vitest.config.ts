import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://gradelens:gradelens@localhost:5432/gradelens_test',
      JWT_SECRET: 'test-secret-test-secret-test-secret-123',
      TOKEN_ENCRYPTION_KEY: 'a'.repeat(64),
      DEV_LOGIN: 'true',
      NODE_ENV: 'test',
      ANTHROPIC_API_KEY: 'test-key',
      GOOGLE_CLIENT_ID: 'test-client',
      GOOGLE_CLIENT_SECRET: 'test-secret',
      EVAL_CONCURRENCY: '3',
    },
  },
});
