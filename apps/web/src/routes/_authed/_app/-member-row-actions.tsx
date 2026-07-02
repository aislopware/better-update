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
import { useState } from "react";

import { MemberAccessSheet } from "./-member-access-sheet";

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
  orgId,
  memberId,
  memberName,
  isPending,
  showPolicies,
  showRemove,
  onRemove,
}: {
  orgId: string;
  memberId: string;
  memberName: string;
  isPending: boolean;
  showPolicies: boolean;
  showRemove: boolean;
  onRemove: (memberId: string) => void;
}) => {
  const [accessOpen, setAccessOpen] = useState(false);

  return (
    <>
      <Menu>
        <ActionsTrigger isPending={isPending} label="Member actions" />
        <MenuPopup align="end">
          {showPolicies ? (
            <MenuGroup>
              <MenuItem
                onClick={() => {
                  setAccessOpen(true);
                }}
              >
                <ShieldIcon strokeWidth={2} />
                <span>Manage access</span>
              </MenuItem>
            </MenuGroup>
          ) : null}
          {showPolicies && showRemove ? <MenuSeparator /> : null}
          {showRemove ? (
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
          ) : null}
        </MenuPopup>
      </Menu>
      {showPolicies ? (
        <MemberAccessSheet
          orgId={orgId}
          memberId={memberId}
          memberName={memberName}
          open={accessOpen}
          onOpenChange={setAccessOpen}
        />
      ) : null}
    </>
  );
};

export const MemberRowActions = ({
  orgId,
  row,
  currentUserId,
  canRemoveMembers,
  canManagePolicies,
  isPending,
  onRemove,
  onCancelInvitation,
}: {
  orgId: string;
  row: Row;
  currentUserId: string;
  canRemoveMembers: boolean;
  canManagePolicies: boolean;
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

  // Admin-ness is a policy attachment, not a role. Each action is gated on its OWN
  // server-computed capability (policy:update for Manage policies, member:delete for
  // Remove) so a partial-capability holder never sees an action the server would
  // 403. The owner's own membership is never managed here: their policies are inert
  // (owner is undeniable root) and they cannot be removed (last-owner guard).
  if (row.role === "owner") {
    return null;
  }
  const isSelf = row.userId === currentUserId;
  const showPolicies = canManagePolicies;
  const showRemove = canRemoveMembers && !isSelf;
  if (!showPolicies && !showRemove) {
    return null;
  }

  return (
    <ActiveMemberActions
      orgId={orgId}
      memberId={row.id}
      memberName={row.name}
      isPending={isPending}
      showPolicies={showPolicies}
      showRemove={showRemove}
      onRemove={onRemove}
    />
  );
};
