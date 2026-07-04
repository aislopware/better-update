import { Button } from "@better-update/ui/components/ui/button";
import {
  Menu,
  MenuPopup,
  MenuGroup,
  MenuItem,
  MenuTrigger,
} from "@better-update/ui/components/ui/menu";
import { EllipsisVerticalIcon, UserMinusIcon } from "lucide-react";

import type { Row } from "./-members-row";

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
  isPending,
  onRemove,
}: {
  memberId: string;
  isPending: boolean;
  onRemove: (memberId: string) => void;
}) => (
  <Menu>
    <ActionsTrigger isPending={isPending} label="Member actions" />
    <MenuPopup align="end">
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
  canRemoveMembers,
  isPending,
  onRemove,
  onCancelInvitation,
}: {
  row: Row;
  currentUserId: string;
  canRemoveMembers: boolean;
  isPending: boolean;
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

  // Each action is gated on its OWN server-computed capability (member:delete for
  // Remove) so a partial-capability holder never sees an action the server would
  // 403. The owner's own membership is never managed here: they cannot be removed
  // (last-owner guard).
  if (row.role === "owner") {
    return null;
  }
  const isSelf = row.userId === currentUserId;
  const showRemove = canRemoveMembers && !isSelf;
  if (!showRemove) {
    return null;
  }

  return <ActiveMemberActions memberId={row.id} isPending={isPending} onRemove={onRemove} />;
};
