/**
 * In-memory sliding-window rate limiter. Appropriate because the deployment
 * model guarantees exactly one writable application instance.
 */
interface Bucket {
  timestamps: number[];
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function checkRateLimit(key: string, maxAttempts: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  if (buckets.size > MAX_BUCKETS) buckets.clear(); // bounded memory under spray attacks
  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);
  buckets.set(key, bucket);
  if (bucket.timestamps.length >= maxAttempts) {
    const oldest = bucket.timestamps[0] ?? now;
    return { allowed: false, retryAfterSeconds: Math.ceil((oldest + windowMs - now) / 1000) };
  }
  bucket.timestamps.push(now);
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Test hook. */
export function resetRateLimits(): void {
  buckets.clear();
}

/** Extract a best-effort client address from a Request for rate limiting/auditing. */
export function clientAddress(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
