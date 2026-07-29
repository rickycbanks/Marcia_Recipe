import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Forbidden } from "@/components/Forbidden";
import { getSessionAccount } from "@/lib/authorization/guards";

export const dynamic = "force-dynamic";

/** Owner-only section. Defense in depth: every admin API re-checks too. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const account = await getSessionAccount();
  if (!account) redirect("/login?callbackUrl=/admin");
  if (account.type !== "owner") {
    return <Forbidden message="The admin area is restricted to the site owner." />;
  }
  return <>{children}</>;
}
