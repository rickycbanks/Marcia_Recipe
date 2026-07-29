import { z } from "zod";
import { AppError } from "./errors";

/**
 * Central environment validation. Validated lazily so unit tests can point
 * DATA_ROOT at temp directories per test; validated eagerly at server startup
 * via instrumentation.ts so misconfiguration fails fast with a clear message.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** Root of all mutable application data. Must exist and be writable. */
  DATA_ROOT: z.string().min(1).default("./data"),
  /**
   * Secret used to sign session JWTs. Required in production; an ephemeral
   * one is generated (with a warning) in development so a fresh clone runs.
   */
  AUTH_SECRET: z.string().min(32).optional(),
  /** Required to create the first owner via the web setup screen. */
  SETUP_TOKEN: z.string().min(8).optional(),
  /** Public origin of the deployment (used in logs/invitation URLs only). */
  APP_ORIGIN: z.url().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional(),
});

export type AppEnv = z.infer<typeof envSchema> & { authSecret: string };

let cached: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new AppError("CONFIG_INVALID", "Invalid environment configuration", parsed.error.issues);
  }
  const env = parsed.data;
  let authSecret = env.AUTH_SECRET;
  if (!authSecret) {
    // Next imports route modules while collecting the production build. The
    // build must not require or embed the runtime signing secret; runtime
    // startup still rejects a missing secret below.
    if (env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
      throw new AppError(
        "CONFIG_INVALID",
        "AUTH_SECRET (>= 32 characters) is required in production. Generate one with: openssl rand -base64 48",
      );
    }
    // Ephemeral build/development secret — never use this for a running
    // production process.
    authSecret = `dev-only-insecure-secret-${process.pid}`;
  }
  cached = { ...env, authSecret };
  return cached;
}

/** Test hook: re-read environment on next getEnv() call. */
export function resetEnvCache(): void {
  cached = null;
}
