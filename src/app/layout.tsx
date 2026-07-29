import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import { getSessionAccount } from "@/lib/authorization/guards";
import { getSiteConfig } from "@/lib/storage/repositories/config";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "Marcia Recipe",
  title: { default: "Marcia Recipe", template: "%s · Marcia Recipe" },
  description: "A self-hosted personal recipe binder.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf8f4" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1915" },
  ],
};

/** Sets data-mode before first paint to avoid a light/dark flash. */
const MODE_SCRIPT = `(function(){try{var m=localStorage.getItem("theme-mode");if(m!=="dark"&&m!=="light"){m=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.dataset.mode=m;}catch(e){document.documentElement.dataset.mode="light";}})();`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [config, account] = await Promise.all([getSiteConfig(), getSessionAccount()]);
  return (
    <html lang="en" data-theme={config.theme} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: MODE_SCRIPT }} />
      </head>
      <body className="flex min-h-screen flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-foreground"
        >
          Skip to content
        </a>
        <SiteHeader
          siteName={config.siteName}
          account={
            account
              ? { username: account.username, displayName: account.displayName, type: account.type, capabilities: account.capabilities }
              : null
          }
        />
        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
          {children}
        </main>
        <footer className="border-t border-border py-6 text-center text-sm text-muted-foreground">
          <p>{config.siteName} — self-hosted &amp; private</p>
        </footer>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
