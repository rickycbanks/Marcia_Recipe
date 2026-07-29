import { redirect } from "next/navigation";
import { SetupForm } from "@/components/forms/SetupForm";
import { anyOwnerExists } from "@/lib/storage/repositories/accounts";

export const dynamic = "force-dynamic";
export const metadata = { title: "First-run setup" };

export default async function SetupPage() {
  // Setup permanently disables itself once an owner exists.
  if (await anyOwnerExists()) redirect("/");
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 py-8">
      <div className="text-center">
        <h1 className="font-display text-3xl font-bold">Welcome to Marcia Recipe</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create the owner account to finish setting up this site. You&apos;ll need the setup token from your
          deployment environment (<code>SETUP_TOKEN</code>).
        </p>
      </div>
      <SetupForm />
    </div>
  );
}
