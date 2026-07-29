import { forbidden } from "@/lib/errors";

/**
 * Validate cookie-authenticated mutations against the request origin. A
 * missing origin is rejected rather than silently accepted: browser mutation
 * requests should always provide Origin or Referer, and non-browser callers
 * can use a separate authenticated integration later.
 */
export function assertSameOrigin(request: Request): void {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return;
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host"))?.split(",")[0]?.trim();
  if (!host) throw forbidden("Host header required");
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const candidate = origin ?? (referer ? safeOrigin(referer) : null);
  if (candidate === null) throw forbidden("Origin header required");

  let candidateHost: string | null = null;
  try {
    candidateHost = new URL(candidate).host;
  } catch {
    candidateHost = null;
  }
  if (!candidateHost || candidateHost.toLowerCase() !== host.toLowerCase()) {
    throw forbidden("Cross-origin request rejected");
  }
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
