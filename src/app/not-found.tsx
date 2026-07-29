import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <p className="text-5xl" aria-hidden>
        🥘
      </p>
      <h1 className="font-display text-3xl font-bold">Page not found</h1>
      <p className="text-muted-foreground">
        This page doesn&apos;t exist — or you don&apos;t have access to it.
      </p>
      <Link href="/" className="btn-primary">
        Back to home
      </Link>
    </div>
  );
}
