import Link from "next/link";

export function Forbidden({ message = "You don't have access to this page." }: { message?: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <p className="text-5xl" aria-hidden>
        🔒
      </p>
      <h1 className="font-display text-3xl font-bold">Access restricted</h1>
      <p className="text-muted-foreground">{message}</p>
      <Link href="/" className="btn-secondary">
        Back to home
      </Link>
    </div>
  );
}
