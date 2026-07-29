// Serwist service worker: precaches the static shell only.
// SECURITY: recipe content, API responses, and media are NEVER cached here —
// protected data must not outlive the session in browser storage.
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { CacheFirst, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

// The worker global scope exists at runtime; avoid pulling in the full
// "webworker" lib types (they conflict with "dom" in this project's tsconfig).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const self: any;

const STATIC_ONLY = /^\/(_next\/static|icons)\//;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST as (PrecacheEntry | string)[] | undefined,
  precacheOptions: { cleanupOutdatedCaches: true },
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  // Only static build assets and icons may be cached. Navigations, API calls,
  // recipe pages, and media always go straight to the network.
  runtimeCaching: [
    {
      matcher: ({ url }: { url: URL }) => STATIC_ONLY.test(url.pathname),
      handler: new CacheFirst({ cacheName: "marcia-static-assets" }),
    },
  ],
  fallbacks: {
    entries: [
      {
        // Generic offline fallback page — contains no protected content.
        url: "/offline",
        matcher({ request }: { request: Request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();
