export type MemberStatus = "active" | "pending";

export interface MemberInput {
  id: string;
  userId: string;
  role: string;
  createdAt: Date;
  user: { id: string; name: string; email: string; image?: string | null | undefined };
}

export interface InvitationInput {
  id: string;
  email: string;
  role: string;
  expiresAt: Date;
}

export interface MemberRow {
  kind: "member";
  id: string;
  userId: string;
  name: string;
  email: string;
  image: string | null | undefined;
  role: string;
  status: "active";
  joinedAt: Date;
}

export interface InvitationRow {
  kind: "invitation";
  id: string;
  userId: null;
  name: string;
  email: string;
  image: undefined;
  role: string;
  status: "pending";
  expiresAt: Date;
}

export type Row = MemberRow | InvitationRow;

export const buildRows = (
  members: readonly MemberInput[],
  invitations: readonly InvitationInput[],
): Row[] => {
  const memberRows: MemberRow[] = members.map((member) => ({
    kind: "member",
    id: member.id,
    userId: member.userId,
    name: member.user.name,
    email: member.user.email,
    image: member.user.image,
    role: member.role,
    status: "active",
    joinedAt: new Date(member.createdAt),
  }));
  const invitationRows: InvitationRow[] = invitations.map((invitation) => ({
    kind: "invitation",
    id: invitation.id,
    userId: null,
    name: invitation.email,
    email: invitation.email,
    image: undefined,
    role: invitation.role,
    status: "pending",
    expiresAt: new Date(invitation.expiresAt),
  }));
  return [...memberRows, ...invitationRows];
};
