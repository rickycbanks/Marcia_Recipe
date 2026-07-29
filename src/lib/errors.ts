/**
 * Structured application errors. Services throw these; route handlers map
 * them to responses via `errorResponse` so internals never leak to clients.
 */

export type AppErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "GONE"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA"
  | "UPSTREAM_FETCH"
  | "STORAGE_CORRUPT"
  | "CONFIG_INVALID"
  | "INTERNAL";

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  GONE: 410,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA: 415,
  UPSTREAM_FETCH: 502,
  STORAGE_CORRUPT: 500,
  CONFIG_INVALID: 500,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  /** Extra detail safe to log server-side (never sent to clients verbatim for 5xx). */
  readonly detail?: unknown;

  constructor(code: AppErrorCode, message: string, detail?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.detail = detail;
  }
}

export const badRequest = (msg: string, detail?: unknown) => new AppError("BAD_REQUEST", msg, detail);
export const unauthenticated = (msg = "Authentication required") => new AppError("UNAUTHENTICATED", msg);
export const forbidden = (msg = "You do not have access to this resource") => new AppError("FORBIDDEN", msg);
export const notFound = (msg = "Not found") => new AppError("NOT_FOUND", msg);
export const conflict = (msg: string, detail?: unknown) => new AppError("CONFLICT", msg, detail);
export const gone = (msg: string) => new AppError("GONE", msg);
export const rateLimited = (msg = "Too many attempts, please try again later") => new AppError("RATE_LIMITED", msg);
export const payloadTooLarge = (msg: string) => new AppError("PAYLOAD_TOO_LARGE", msg);
export const unsupportedMedia = (msg: string) => new AppError("UNSUPPORTED_MEDIA", msg);
export const upstreamFetch = (msg: string, detail?: unknown) => new AppError("UPSTREAM_FETCH", msg, detail);
export const storageCorrupt = (msg: string, detail?: unknown) => new AppError("STORAGE_CORRUPT", msg, detail);

/** Map any thrown value to a safe HTTP status + client-facing message. */
export function toErrorResponse(err: unknown): { status: number; body: { error: string; code: AppErrorCode } } {
  if (err instanceof AppError) {
    const safeMessage = err.status >= 500 ? "Internal server error" : err.message;
    return { status: err.status, body: { error: safeMessage, code: err.code } };
  }
  return { status: 500, body: { error: "Internal server error", code: "INTERNAL" } };
}
