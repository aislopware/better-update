import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuPopup,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@better-update/ui/components/ui/menu";
import { EllipsisVerticalIcon, Loader2Icon, ShieldIcon, UserMinusIcon } from "lucide-react";

import { EntityAvatar } from "../../../lib/entity-avatar";
import { formatRelativeFuture, formatRelativeTime } from "../../../lib/format-relative-time";

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
        render={<Button variant="ghost" size="icon" disabled={isPending} aria-busy={isPending} />}
      >
        {isPending ? (
          <Loader2Icon className="animate-spin" />
        ) : (
          <EllipsisVerticalIcon strokeWidth={2} />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuPopup align="end">
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
      </DropdownMenuPopup>
    </DropdownMenu>
  );
};

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
  <ul className="flex flex-col divide-y">
    {members.map((member) => (
      <li key={member.id} className="flex items-center gap-3 px-6 py-3">
        <EntityAvatar name={member.user.name || "U"} image={member.user.image} className="size-9" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm leading-none font-medium">{member.user.name}</span>
          <span className="text-muted-foreground truncate text-xs">{member.user.email}</span>
        </div>
        <Badge variant={roleBadgeVariant(member.role)} className="capitalize">
          {member.role}
        </Badge>
        <span className="text-muted-foreground hidden w-32 text-xs tabular-nums sm:block">
          Joined {formatRelativeTime(new Date(member.createdAt).toISOString())}
        </span>
        <div className="flex w-9 justify-end">
          <MemberActions
            memberId={member.id}
            memberRole={member.role}
            currentRole={currentRole}
            isSelf={member.userId === currentUserId}
            isPending={pendingMemberId === member.id}
            onRoleChange={onRoleChange}
            onRemove={onRemove}
          />
        </div>
      </li>
    ))}
  </ul>
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
  <ul className="flex flex-col divide-y">
    {invitations.map((invitation) => {
      const isPending = pendingInvitationId === invitation.id;
      return (
        <li key={invitation.id} className="flex items-center gap-3 px-6 py-3">
          <span className="bg-muted/72 text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md border text-sm font-medium">
            {invitation.email.charAt(0).toUpperCase()}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-sm leading-none font-medium">{invitation.email}</span>
            <span className="text-muted-foreground text-xs">
              Expires {formatRelativeFuture(new Date(invitation.expiresAt).toISOString())}
            </span>
          </div>
          <Badge variant={roleBadgeVariant(invitation.role)} className="capitalize">
            {invitation.role}
          </Badge>
          <div className="flex w-9 justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={isPending}
                    aria-busy={isPending}
                    aria-label="Invitation actions"
                  />
                }
              >
                {isPending ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <EllipsisVerticalIcon strokeWidth={2} />
                )}
              </DropdownMenuTrigger>
              <DropdownMenuPopup align="end">
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => {
                    onCancel(invitation.id);
                  }}
                >
                  <UserMinusIcon strokeWidth={2} />
                  <span>Cancel invitation</span>
                </DropdownMenuItem>
              </DropdownMenuPopup>
            </DropdownMenu>
          </div>
        </li>
      );
    })}
  </ul>
);
