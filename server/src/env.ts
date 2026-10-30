import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(8080),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),
  PUBLIC_API_URL: z.string().url().default('http://localhost:8080'),
  FRONTEND_URL: z.string().url().optional(),
  EXTRA_CORS_ORIGINS: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  ALLOWED_EMAIL_DOMAINS: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GRADING_MODEL: z.string().default('claude-haiku-5-5'),
  REVIEW_MODEL: z.string().default('claude-sonnet-5-5'),
  KEY_MODEL: z.string().default('claude-sonnet-5-5'),
  EVAL_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  ESCALATION_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.7),
  USD_TO_INR: z.coerce.number().default(86),
  DEV_LOGIN: bool,
  SERVE_WEB_DIR: z.string().optional(),
  RUN_MIGRATIONS_ON_START: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  FRONTEND_URL: parsed.data.FRONTEND_URL ?? parsed.data.PUBLIC_API_URL,
  isProd: parsed.data.NODE_ENV === 'production',
  allowedDomains: (parsed.data.ALLOWED_EMAIL_DOMAINS ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean),
  devLoginEnabled: parsed.data.DEV_LOGIN && parsed.data.NODE_ENV !== 'production',
  googleConfigured: Boolean(parsed.data.GOOGLE_CLIENT_ID && parsed.data.GOOGLE_CLIENT_SECRET),
  aiConfigured: Boolean(parsed.data.ANTHROPIC_API_KEY),
};
