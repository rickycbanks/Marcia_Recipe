import Link from "next/link";

export const metadata = { title: "Offline" };

/** Generic offline shell — deliberately contains no protected content. */
export default function OfflinePage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <p className="text-5xl" aria-hidden>
        📴
      </p>
      <h1 className="font-display text-3xl font-bold">You&apos;re offline</h1>
      <p className="text-muted-foreground">
        This app needs a connection for recipe content. Once you&apos;re back online, everything will be
        available again.
      </p>
      <Link href="/" className="btn-primary">
        Try again
      </Link>
    </div>
  );
}
