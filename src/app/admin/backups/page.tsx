import { BackupsPanel } from "@/components/admin/BackupsPanel";
import { listBackups } from "@/lib/backups/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Backups" };

export default async function AdminBackupsPage() {
  const backups = await listBackups();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-bold">Backups</h1>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Archives capture all canonical data (config, accounts, invitations, recipes with media, and personal
        plans/lists) under the global write lock, so they never contain partially written operations. Derived
        indexes, caches, locks and temp files are excluded. Store copies off-host (see the deployment guide).
      </p>
      <BackupsPanel backups={backups} />
    </div>
  );
}
