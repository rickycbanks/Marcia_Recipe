import { redirect } from "next/navigation";
import { ChangePasswordForm } from "@/components/forms/ChangePasswordForm";
import { getSessionAccount } from "@/lib/authorization/guards";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your account" };

export default async function AccountPage() {
  const account = await getSessionAccount();
  if (!account) redirect("/login?callbackUrl=/account");

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-8">
      <section className="card p-6">
        <h1 className="mb-4 font-display text-2xl font-bold">Your account</h1>
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Display name</dt>
            <dd className="font-medium">{account.displayName}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Username</dt>
            <dd className="font-medium">{account.username}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Account type</dt>
            <dd className="font-medium capitalize">{account.type}</dd>
          </div>
          {account.type === "guest" ? (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Capabilities</dt>
              <dd className="font-medium">
                {account.capabilities.length > 0 ? account.capabilities.join(", ") : "none"}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="card p-6">
        <h2 className="mb-2 font-display text-xl font-semibold">Change password</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Changing your password signs out all sessions, including this one.
        </p>
        <ChangePasswordForm />
      </section>
    </div>
  );
}
