import { InviteAcceptForm } from "@/components/forms/InviteAcceptForm";
import { EmptyState } from "@/components/EmptyState";
import { previewInvitation } from "@/lib/invitations/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Accept invitation" };

interface Props {
  params: Promise<{ invitationId: string; secret: string }>;
}

export default async function InvitePage({ params }: Props) {
  const { invitationId, secret } = await params;
  const preview = await previewInvitation(invitationId, secret).catch(() => ({ valid: false, capabilities: [], expiresAt: null }));

  if (!preview.valid) {
    return (
      <div className="mx-auto max-w-md py-8">
        <EmptyState title="Invitation unavailable">
          <p>This invitation link is invalid, expired, cancelled, or has already been used.</p>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 py-8">
      <div className="text-center">
        <h1 className="font-display text-3xl font-bold">You&apos;re invited</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create your guest account to access {preview.capabilities.length > 0 ? "recipes and planning tools" : "the site"}.
        </p>
      </div>
      <InviteAcceptForm invitationId={invitationId} secret={secret} />
    </div>
  );
}
