"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type OcrProvider = "tesseract" | "mistral" | "gemini";

interface SanitizedConfig {
  activeProvider: OcrProvider;
  configured: Record<OcrProvider, boolean>;
  keyringAvailable: boolean;
}

interface MistralFields {
  apiKey: string;
}

interface GeminiFields {
  apiKey: string;
}

export function OcrSettingsForm({ initial }: { initial: SanitizedConfig }) {
  const router = useRouter();
  const [config, setConfig] = useState<SanitizedConfig>(initial);
  const [activeProvider, setActiveProvider] = useState<OcrProvider>(initial.activeProvider);
  const [mistral, setMistral] = useState<MistralFields>({ apiKey: "" });
  const [gemini, setGemini] = useState<GeminiFields>({ apiKey: "" });
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);

    const patch: {
      activeProvider: OcrProvider;
      mistral?: { apiKey: string };
      gemini?: { apiKey: string };
    } = { activeProvider };

    // Only send provider-specific fields when they have values (blank retains existing)
    if (activeProvider === "mistral" && mistral.apiKey) {
      patch.mistral = { apiKey: mistral.apiKey };
    } else if (activeProvider === "gemini" && gemini.apiKey) {
      patch.gemini = { apiKey: gemini.apiKey };
    }

    const response = await fetch("/api/admin/ocr-settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });

    if (!response.ok) {
      setBusy(false);
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Could not save OCR settings.");
      return;
    }

    setStatus("OCR settings saved.");
    // Re-read the sanitized config from the server to update configured-status
    // indicators, then refresh the full page so the server component re-renders.
    try {
      const refresh = await fetch("/api/admin/ocr-settings");
      if (refresh.ok) {
        const body = (await refresh.json()) as SanitizedConfig;
        setConfig(body);
        setActiveProvider(body.activeProvider);
      }
    } catch {
      // Best effort — router.refresh below will re-render the server component.
    }
    setBusy(false);
    router.refresh();
  };

  const configuredStatus = (provider: OcrProvider): string => {
    if (provider === "tesseract") return "Always available";
    if (config.configured[provider]) return "Configured";
    return "Not configured";
  };

  return (
    <form onSubmit={onSubmit} className="card flex flex-col gap-4 p-6">
      <div>
        <h2 className="font-display text-lg font-semibold">OCR Provider</h2>
        <p className="help-text">
          Select the OCR engine used for recipe photo imports. This setting applies site-wide.
          Import users cannot override it. Cloud providers use a two-pass pipeline: first OCR the
          image, then extract structured recipe data via AI.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label className="label">Active provider</label>
        <div className="flex flex-col gap-2">
          {(["tesseract", "mistral", "gemini"] as const).map((provider) => (
            <label key={provider} className="flex items-center gap-3 rounded-md border border-border p-3 has-[:checked]:border-accent has-[:checked]:bg-accent/5">
              <input
                type="radio"
                name="ocr-provider"
                value={provider}
                checked={activeProvider === provider}
                onChange={() => setActiveProvider(provider)}
                className="accent-current"
              />
              <div className="flex flex-col">
                <span className="text-sm font-medium">
                  {provider === "tesseract" && "Tesseract (browser-local)"}
                  {provider === "mistral" && "Mistral OCR"}
                  {provider === "gemini" && "Gemini"}
                </span>
                <span className="text-xs text-muted-foreground">{configuredStatus(provider)}</span>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Mistral fields */}
      {activeProvider === "mistral" && (
        <div className="flex flex-col gap-2 rounded-md border border-border p-4">
          <p className="text-sm font-medium">Mistral credentials</p>
          <p className="help-text">
            Uses <code className="rounded bg-muted px-1">mistral-ocr-latest</code> for OCR and
            <code className="rounded bg-muted px-1">ministral-3b-2512</code> for structured extraction.
          </p>
          <div>
            <label htmlFor="mistral-api-key" className="label">
              API Key
            </label>
            <input
              id="mistral-api-key"
              type="password"
              className="input"
              placeholder={config.configured.mistral ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (saved)" : "Enter Mistral API key"}
              value={mistral.apiKey}
              onChange={(e) => setMistral({ ...mistral, apiKey: e.target.value })}
              autoComplete="off"
            />
            <p className="help-text">Leave blank to keep the existing key. Get a key from https://console.mistral.ai</p>
          </div>
        </div>
      )}

      {/* Gemini fields */}
      {activeProvider === "gemini" && (
        <div className="flex flex-col gap-2 rounded-md border border-border p-4">
          <p className="text-sm font-medium">Gemini credentials</p>
          <p className="help-text">
            Uses <code className="rounded bg-muted px-1">gemini-3.5-flash-lite</code> for both OCR
            and structured extraction via the Google Generative Language API.
          </p>
          <div>
            <label htmlFor="gemini-api-key" className="label">
              API Key
            </label>
            <input
              id="gemini-api-key"
              type="password"
              className="input"
              placeholder={config.configured.gemini ? "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (saved)" : "Enter Gemini API key"}
              value={gemini.apiKey}
              onChange={(e) => setGemini({ ...gemini, apiKey: e.target.value })}
              autoComplete="off"
            />
            <p className="help-text">Leave blank to keep the existing key. Get a key from https://aistudio.google.com/apikey</p>
          </div>
        </div>
      )}

      {/* Tesseract info */}
      {activeProvider === "tesseract" && (
        <div className="rounded-md border border-border p-4">
          <p className="text-sm text-muted-foreground">
            Tesseract runs entirely in the browser. No credentials are needed.
            Recipe images are processed locally and never leave the user&apos;s device.
          </p>
        </div>
      )}

      {/* Keyring prerequisite warning */}
      {!config.keyringAvailable && activeProvider !== "tesseract" && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-medium">Encryption key required</p>
          <p className="mt-1">
            Cloud OCR credentials are stored encrypted. To save credentials, the
            <code className="mx-1 rounded bg-amber-100 px-1 dark:bg-amber-900">PRIVATE_CONFIG_KEYRING</code>
            environment variable must be configured with at least one key.
            Format: <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">keyId:base64url(32-byte-key)</code>
          </p>
        </div>
      )}

      {/* Legacy config notice */}
      {config.activeProvider === "tesseract" &&
        (config.configured.mistral || config.configured.gemini) && (
        <div className="rounded-md border border-blue-300 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-200">
          <p className="font-medium">Reconfiguration needed</p>
          <p className="mt-1">
            If you previously used Veryfi or Google Document AI, those providers
            have been removed. Your credentials were safely discarded on the last
            settings save. Select a new cloud provider above and enter its API key
            to re-enable server-side OCR.
          </p>
        </div>
      )}

      {status ? <p className="text-sm text-accent">{status}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn-primary self-start" disabled={busy}>
        {busy ? "Saving\u2026" : "Save OCR settings"}
      </button>
    </form>
  );
}
