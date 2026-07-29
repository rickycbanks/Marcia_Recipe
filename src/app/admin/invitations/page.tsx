import { InvitationsAdmin } from "@/components/admin/InvitationsAdmin";
import { listAllInvitations } from "@/lib/invitations/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invitations" };

export default async function AdminInvitationsPage() {
  const invitations = await listAllInvitations();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-bold">Invitations</h1>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Invite guests with exactly the capabilities they need. Invitation links are single-use and expire;
        the secret is shown only once, at creation.
      </p>
      <InvitationsAdmin
        invitations={invitations.map((i) => ({
          id: i.id,
          capabilities: i.capabilities,
          expiresAt: i.expiresAt,
          status: i.status,
          issuedAt: i.issuedAt,
        }))}
      />
    </div>
  );
}
