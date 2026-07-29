import { SettingsForm } from "@/components/admin/SettingsForm";
import { getSiteConfig } from "@/lib/storage/repositories/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Site settings" };

export default async function AdminSettingsPage() {
  const config = await getSiteConfig();
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <h1 className="font-display text-3xl font-bold">Site settings</h1>
      <SettingsForm
        initial={{
          siteName: config.siteName,
          defaultVisibility: config.defaultVisibility,
          theme: config.theme,
        }}
      />
    </div>
  );
}
