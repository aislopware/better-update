import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@better-update/ui/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { EllipsisVerticalIcon, Loader2Icon, UserMinusIcon, ShieldIcon, XIcon } from "lucide-react";

import { EntityAvatar } from "../../../lib/entity-avatar";

const roleBadgeVariant = (role: string): "default" | "secondary" | "outline" => {
  if (role === "owner") {
    return "default";
  }
  if (role === "admin") {
    return "secondary";
  }
  return "outline";
};

const canManageRole = (currentRole: string, targetRole: string): boolean =>
  currentRole === "owner" && targetRole !== "owner";

const MemberActions = ({
  memberId,
  memberRole,
  currentRole,
  isSelf,
  isPending,
  onRoleChange,
  onRemove,
}: {
  memberId: string;
  memberRole: string;
  currentRole: string;
  isSelf: boolean;
  isPending: boolean;
  onRoleChange: (memberId: string, role: string) => void;
  onRemove: (memberId: string) => void;
}) => {
  if (isSelf || !canManageRole(currentRole, memberRole)) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" disabled={isPending} aria-busy={isPending} />
        }
      >
        {isPending ? (
          <Loader2Icon className="animate-spin" />
        ) : (
          <EllipsisVerticalIcon strokeWidth={2} />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          {memberRole === "admin" ? null : (
            <DropdownMenuItem
              onClick={() => {
                onRoleChange(memberId, "admin");
              }}
            >
              <ShieldIcon strokeWidth={2} />
              <span>Set as Admin</span>
            </DropdownMenuItem>
          )}
          {memberRole === "member" ? null : (
            <DropdownMenuItem
              onClick={() => {
                onRoleChange(memberId, "member");
              }}
            >
              <ShieldIcon strokeWidth={2} />
              <span>Set as Member</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              onRemove(memberId);
            }}
          >
            <UserMinusIcon strokeWidth={2} />
            <span>Remove member</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const MemberInfo = ({
  name,
  email,
  image,
}: {
  name: string;
  email: string;
  image?: string | null | undefined;
}) => (
  <div className="flex items-center gap-3">
    <EntityAvatar name={name || "U"} image={image} />
    <div>
      <p className="leading-none font-medium">{name}</p>
      <p className="text-muted-foreground text-xs">{email}</p>
    </div>
  </div>
);

export const MembersTableView = ({
  members,
  currentUserId,
  currentRole,
  pendingMemberId,
  onRoleChange,
  onRemove,
}: {
  members: {
    id: string;
    userId: string;
    role: string;
    createdAt: Date;
    user: { id: string; name: string; email: string; image?: string | null | undefined };
  }[];
  currentUserId: string;
  currentRole: string;
  pendingMemberId?: string | undefined;
  onRoleChange: (memberId: string, role: string) => void;
  onRemove: (memberId: string) => void;
}) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Member</TableHead>
        <TableHead>Role</TableHead>
        <TableHead>Joined</TableHead>
        <TableHead className="w-12" />
      </TableRow>
    </TableHeader>
    <TableBody>
      {members.map((member) => (
        <TableRow key={member.id}>
          <TableCell>
            <MemberInfo
              name={member.user.name}
              email={member.user.email}
              image={member.user.image}
            />
          </TableCell>
          <TableCell>
            <Badge variant={roleBadgeVariant(member.role)}>{member.role}</Badge>
          </TableCell>
          <TableCell className="text-muted-foreground tabular-nums">
            {new Date(member.createdAt).toLocaleDateString()}
          </TableCell>
          <TableCell>
            <MemberActions
              memberId={member.id}
              memberRole={member.role}
              currentRole={currentRole}
              isSelf={member.userId === currentUserId}
              isPending={pendingMemberId === member.id}
              onRoleChange={onRoleChange}
              onRemove={onRemove}
            />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

export const InvitationsTableView = ({
  invitations,
  pendingInvitationId,
  onCancel,
}: {
  invitations: {
    id: string;
    email: string;
    role: string;
    status: string;
    expiresAt: Date;
  }[];
  pendingInvitationId?: string | undefined;
  onCancel: (invitationId: string) => void;
}) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Email</TableHead>
        <TableHead>Role</TableHead>
        <TableHead>Expires</TableHead>
        <TableHead className="w-12" />
      </TableRow>
    </TableHeader>
    <TableBody>
      {invitations.map((invitation) => {
        const isPending = pendingInvitationId === invitation.id;
        return (
          <TableRow key={invitation.id}>
            <TableCell className="font-medium">{invitation.email}</TableCell>
            <TableCell>
              <Badge variant={roleBadgeVariant(invitation.role)}>{invitation.role}</Badge>
            </TableCell>
            <TableCell className="text-muted-foreground tabular-nums">
              {new Date(invitation.expiresAt).toLocaleDateString()}
            </TableCell>
            <TableCell>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  onCancel(invitation.id);
                }}
                disabled={isPending}
                aria-busy={isPending}
              >
                {isPending ? <Loader2Icon className="animate-spin" /> : <XIcon strokeWidth={2} />}
              </Button>
            </TableCell>
          </TableRow>
        );
      })}
    </TableBody>
  </Table>
);
