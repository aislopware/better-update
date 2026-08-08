export type MemberStatus = "active" | "pending";

export interface MemberInput {
  id: string;
  userId: string;
  role: string;
  createdAt: Date;
  user: { id: string; name: string; email: string };
}

export interface InvitationInput {
  id: string;
  email: string;
  role: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface MemberRow {
  kind: "member";
  id: string;
  userId: string;
  name: string;
  email: string;
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
  role: string;
  status: "pending";
  invitedAt: Date;
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
    role: invitation.role,
    status: "pending",
    invitedAt: new Date(invitation.createdAt),
    expiresAt: new Date(invitation.expiresAt),
  }));
  return [...memberRows, ...invitationRows];
};
