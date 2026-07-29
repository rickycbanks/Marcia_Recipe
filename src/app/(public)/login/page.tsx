import { redirect } from "next/navigation";
import { LoginForm } from "@/components/forms/LoginForm";
import { getSessionAccount } from "@/lib/authorization/guards";
import { anyOwnerExists } from "@/lib/storage/repositories/accounts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

interface Props {
  searchParams: Promise<{ callbackUrl?: string }>;
}

export default async function LoginPage({ searchParams }: Props) {
  if (!(await anyOwnerExists())) redirect("/setup");
  const account = await getSessionAccount();
  const { callbackUrl } = await searchParams;
  if (account) redirect(callbackUrl?.startsWith("/") ? callbackUrl : "/");

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 py-8">
      <div className="text-center">
        <h1 className="font-display text-3xl font-bold">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">Use the account details provided by the site owner.</p>
      </div>
      <LoginForm callbackUrl={callbackUrl?.startsWith("/") ? callbackUrl : "/"} />
    </div>
  );
}
