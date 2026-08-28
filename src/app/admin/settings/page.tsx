import { SettingsForm } from "@/components/admin/SettingsForm";
import { OcrSettingsForm } from "@/components/admin/OcrSettingsForm";
import { getSiteConfig } from "@/lib/storage/repositories/config";
import { getSanitizedOcrConfig } from "@/lib/config/ocrPrivate";

export const dynamic = "force-dynamic";
export const metadata = { title: "Site settings" };

export default async function AdminSettingsPage() {
  const [config, ocrConfig] = await Promise.all([getSiteConfig(), getSanitizedOcrConfig()]);
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
      <OcrSettingsForm initial={ocrConfig} />
    </div>
  );
}
