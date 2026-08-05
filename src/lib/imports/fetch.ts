import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from "undici";
import { payloadTooLarge, upstreamFetch } from "@/lib/errors";
import { IMPORT_LIMITS } from "@/lib/validation/constants";

/**
 * SSRF-safe outbound fetching for recipe imports:
 * - http/https only, standard ports only, no credentials in URL
 * - every hostname is DNS-resolved and ALL addresses must be public
 * - DNS is PINNED via a custom agent lookup (defeats rebinding/TOCTOU)
 * - every redirect hop is re-validated through the same pipeline
 * - strict size, timeout, redirect-count and content-type limits
 */

export interface FetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  allowedContentTypes?: RegExp;
  /** Test seam: override DNS resolution. */
  lookupFn?: typeof dnsLookup;
  /** Test seam: override the underlying fetch implementation. */
  fetchImpl?: typeof undiciFetch;
}

export interface FetchedPage {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
}

const DEFAULT_ALLOWED_TYPES = /^(text\/html|application\/xhtml\+xml|text\/plain|text\/markdown)/i;

/** True only for public, globally routable addresses. */
export function isPublicIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPublicIpv4(ip);
  if (version === 6) return isPublicIpv6(ip.toLowerCase());
  return false;
}

function isPublicIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return false; // 0.0.0.0/8 "this host"
  if (a === 10) return false; // RFC1918
  if (a === 127) return false; // loopback
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT 100.64.0.0/10
  if (a === 169 && b === 254) return false; // link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return false; // RFC1918
  if (a === 192 && b === 168) return false; // RFC1918
  if (a === 192 && b === 0) return false; // IETF protocol assignments incl. 192.0.2.0/24 TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && parts[2] === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && parts[2] === 113) return false; // TEST-NET-3
  if (a >= 224) return false; // multicast + reserved + broadcast
  return true;
}

function isPublicIpv6(ip: string): boolean {
  if (ip === "::" || ip === "::1") return false; // unspecified + loopback
  // IPv4-mapped ::ffff:a.b.c.d (hex or dotted tail) — evaluate the embedded v4.
  const mapped = /^(0*:){0,5}0*ffff:(.+)$/.exec(ip);
  if (mapped) {
    const tail = mapped[2]!;
    if (tail.includes(".")) return isPublicIpv4(tail);
    const groups = tail.split(":").map((g) => parseInt(g || "0", 16));
    if (groups.length <= 2) {
      const hi = groups[groups.length - 2] ?? 0;
      const lo = groups[groups.length - 1] ?? 0;
      return isPublicIpv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return false;
  }
  if (ip.startsWith("64:ff9b::") || ip.startsWith("64:ff9b:0:")) return false; // NAT64 embeds v4
  if (ip.startsWith("2001::") || ip.startsWith("2001:0:")) return false; // Teredo embeds v4
  if (ip.startsWith("2001:db8:")) return false; // documentation
  const firstGroup = parseInt(ip.split(":")[0] || "0", 16);
  if (firstGroup >= 0xfc00 && firstGroup <= 0xfdff) return false; // ULA fc00::/7
  if (firstGroup >= 0xfe80 && firstGroup <= 0xfebf) return false; // link-local fe80::/10
  if (firstGroup >= 0xff00) return false; // multicast ff00::/8
  if (ip.startsWith("100::")) return false; // discard-only 100::/64
  return true;
}

/** Validate protocol/port/credentials before DNS is even consulted. */
export function assertFetchableUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw upstreamFetch("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw upstreamFetch("Only http and https URLs are allowed");
  }
  if (url.username || url.password) {
    throw upstreamFetch("URLs with embedded credentials are not allowed");
  }
  const port = url.port === "" ? (url.protocol === "https:" ? "443" : "80") : url.port;
  if (port !== "80" && port !== "443") {
    throw upstreamFetch("Only standard web ports (80/443) are allowed");
  }
  return url;
}

async function resolvePublicAddresses(
  hostname: string,
  lookupFn: typeof dnsLookup,
): Promise<{ address: string; family: number }[]> {
  let addresses;
  try {
    addresses = await lookupFn(hostname, { all: true, verbatim: true });
  } catch (err) {
    throw upstreamFetch("DNS resolution failed for host", { hostname, error: String(err) });
  }
  const publicAddresses = addresses.filter((a) => isPublicIp(a.address));
  if (publicAddresses.length === 0) {
    throw upstreamFetch("Host does not resolve to a public address", { hostname });
  }
  return publicAddresses;
}

/** Build an undici Agent whose DNS lookup validates and pins the resolved IP. */
function pinnedAgent(lookupFn: typeof dnsLookup): Agent {
  return new Agent({
    headersTimeout: IMPORT_LIMITS.timeoutMs,
    bodyTimeout: IMPORT_LIMITS.timeoutMs,
    connect: {
      lookup: (hostname, options, callback) => {
        resolvePublicAddresses(hostname, lookupFn)
          .then((addresses) => {
            // undici passes `all: true` in the lookup options and expects the
            // array form (err, addresses[]); the single-address form
            // (err, address, family) is misread as an array and yields
            // ERR_INVALID_IP_ADDRESS: Invalid IP address: undefined.
            if ((options as { all?: boolean } | undefined)?.all) {
              callback(null, addresses);
              return;
            }
            const first = addresses[0]!;
            callback(null, first.address, first.family);
          })
          .catch((err) => callback(err as Error, [], 0));
      },
    },
  });
}

async function readBodyWithLimit(response: UndiciResponse, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw payloadTooLarge("Response exceeds the import size limit");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw payloadTooLarge("Response exceeds the import size limit");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

/** Fetch a URL following (validated) redirects. Every hop re-runs all checks. */
export async function ssrfSafeFetch(rawUrl: string, options: FetchOptions = {}): Promise<FetchedPage> {
  const maxBytes = options.maxBytes ?? IMPORT_LIMITS.maxBytes;
  const timeoutMs = options.timeoutMs ?? IMPORT_LIMITS.timeoutMs;
  const maxRedirects = options.maxRedirects ?? IMPORT_LIMITS.maxRedirects;
  const allowedTypes = options.allowedContentTypes ?? DEFAULT_ALLOWED_TYPES;
  const lookupFn = options.lookupFn ?? dnsLookup;

  const agent = pinnedAgent(lookupFn);
  const fetchImpl = options.fetchImpl ?? undiciFetch;
  const deadline = Date.now() + timeoutMs * (maxRedirects + 1);

  let currentUrl = assertFetchableUrl(rawUrl).toString();
  const requestedUrl = currentUrl;

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const url = assertFetchableUrl(currentUrl);
      await resolvePublicAddresses(url.hostname, lookupFn); // pre-flight validation

      const remaining = Math.max(1, deadline - Date.now());
      const response = await fetchImpl(currentUrl, {
        redirect: "manual",
        signal: AbortSignal.timeout(remaining),
        dispatcher: agent,
        headers: {
          "user-agent": "MarciaRecipe/1.0 (+recipe import; owner-triggered)",
          accept: "text/html,application/xhtml+xml,text/plain,text/markdown",
        },
      } as Parameters<typeof undiciFetch>[1]);

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location) throw upstreamFetch("Redirect without a Location header");
        if (hop === maxRedirects) throw upstreamFetch("Too many redirects");
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (response.status < 200 || response.status >= 300) {
        await response.body?.cancel().catch(() => undefined);
        throw upstreamFetch(`Upstream responded with status ${response.status}`);
      }
      if (!allowedTypes.test(contentType)) {
        await response.body?.cancel().catch(() => undefined);
        throw upstreamFetch(`Unsupported content type: ${contentType.split(";")[0] || "unknown"}`);
      }
      const body = await readBodyWithLimit(response, maxBytes);
      return { requestedUrl, finalUrl: currentUrl, status: response.status, contentType, body };
    }
    throw upstreamFetch("Too many redirects");
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw upstreamFetch("Import timed out");
    }
    throw err;
  } finally {
    await agent.close().catch(() => undefined);
  }
}
