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

import type { Row } from "./-members-row";

const canManageRole = (currentRole: string, targetRole: string): boolean =>
  currentRole === "owner" && targetRole !== "owner";

const ActionsTrigger = ({ isPending, label }: { isPending: boolean; label?: string }) => (
  <DropdownMenuTrigger
    render={
      <Button
        variant="ghost"
        size="icon"
        disabled={isPending}
        aria-busy={isPending}
        aria-label={label}
      />
    }
  >
    {isPending ? (
      <Loader2Icon className="animate-spin" />
    ) : (
      <EllipsisVerticalIcon strokeWidth={2} />
    )}
  </DropdownMenuTrigger>
);

const InvitationActions = ({
  invitationId,
  isPending,
  onCancelInvitation,
}: {
  invitationId: string;
  isPending: boolean;
  onCancelInvitation: (invitationId: string) => void;
}) => (
  <DropdownMenu>
    <ActionsTrigger isPending={isPending} label="Invitation actions" />
    <DropdownMenuPopup align="end">
      <DropdownMenuItem
        variant="destructive"
        onClick={() => {
          onCancelInvitation(invitationId);
        }}
      >
        <UserMinusIcon strokeWidth={2} />
        <span>Cancel invitation</span>
      </DropdownMenuItem>
    </DropdownMenuPopup>
  </DropdownMenu>
);

const ActiveMemberActions = ({
  memberId,
  memberRole,
  isPending,
  onRoleChange,
  onRemove,
}: {
  memberId: string;
  memberRole: string;
  isPending: boolean;
  onRoleChange: (memberId: string, role: string) => void;
  onRemove: (memberId: string) => void;
}) => (
  <DropdownMenu>
    <ActionsTrigger isPending={isPending} />
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

export const MemberRowActions = ({
  row,
  currentUserId,
  currentRole,
  isPending,
  onRoleChange,
  onRemove,
  onCancelInvitation,
}: {
  row: Row;
  currentUserId: string;
  currentRole: string;
  isPending: boolean;
  onRoleChange: (memberId: string, role: string) => void;
  onRemove: (memberId: string) => void;
  onCancelInvitation: (invitationId: string) => void;
}) => {
  if (row.kind === "invitation") {
    return (
      <InvitationActions
        invitationId={row.id}
        isPending={isPending}
        onCancelInvitation={onCancelInvitation}
      />
    );
  }

  const isSelf = row.userId === currentUserId;
  if (isSelf || !canManageRole(currentRole, row.role)) {
    return null;
  }

  return (
    <ActiveMemberActions
      memberId={row.id}
      memberRole={row.role}
      isPending={isPending}
      onRoleChange={onRoleChange}
      onRemove={onRemove}
    />
  );
};
