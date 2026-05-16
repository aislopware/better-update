import { Button } from "@better-update/ui/components/ui/button";
import {
  Menu,
  MenuPopup,
  MenuGroup,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@better-update/ui/components/ui/menu";
import { EllipsisVerticalIcon, ShieldIcon, UserMinusIcon } from "lucide-react";

import type { Row } from "./-members-row";

const canManageRole = (currentRole: string, targetRole: string): boolean =>
  currentRole === "owner" && targetRole !== "owner";

const ActionsTrigger = ({ isPending, label }: { isPending: boolean; label?: string }) => (
  <MenuTrigger
    render={<Button variant="ghost" size="icon" loading={isPending} aria-label={label} />}
  >
    <EllipsisVerticalIcon strokeWidth={2} />
  </MenuTrigger>
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
  <Menu>
    <ActionsTrigger isPending={isPending} label="Invitation actions" />
    <MenuPopup align="end">
      <MenuItem
        variant="destructive"
        onClick={() => {
          onCancelInvitation(invitationId);
        }}
      >
        <UserMinusIcon strokeWidth={2} />
        <span>Cancel invitation</span>
      </MenuItem>
    </MenuPopup>
  </Menu>
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
  <Menu>
    <ActionsTrigger isPending={isPending} />
    <MenuPopup align="end">
      <MenuGroup>
        {memberRole === "admin" ? null : (
          <MenuItem
            onClick={() => {
              onRoleChange(memberId, "admin");
            }}
          >
            <ShieldIcon strokeWidth={2} />
            <span>Set as Admin</span>
          </MenuItem>
        )}
        {memberRole === "member" ? null : (
          <MenuItem
            onClick={() => {
              onRoleChange(memberId, "member");
            }}
          >
            <ShieldIcon strokeWidth={2} />
            <span>Set as Member</span>
          </MenuItem>
        )}
      </MenuGroup>
      <MenuSeparator />
      <MenuGroup>
        <MenuItem
          variant="destructive"
          onClick={() => {
            onRemove(memberId);
          }}
        >
          <UserMinusIcon strokeWidth={2} />
          <span>Remove member</span>
        </MenuItem>
      </MenuGroup>
    </MenuPopup>
  </Menu>
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
