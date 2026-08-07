import { Button } from "@better-update/ui/components/button";
import { DropdownMenu } from "@better-update/ui/components/dropdown";
import { Loader } from "@better-update/ui/components/loader";
import { DotsThreeVerticalIcon, UserMinusIcon } from "@phosphor-icons/react";

import type { Row } from "./-members-row";

const ActionsTrigger = ({ isPending, label }: { isPending: boolean; label: string }) => (
  <DropdownMenu.Trigger
    render={
      <Button
        variant="ghost"
        shape="square"
        className="text-muted-foreground/70 hover:text-foreground"
        disabled={isPending}
        aria-label={label}
      />
    }
  >
    {isPending ? <Loader size="sm" /> : <DotsThreeVerticalIcon weight="bold" />}
  </DropdownMenu.Trigger>
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
    {/* w-auto: size to the labels, not the icon-button anchor width. */}
    <DropdownMenu.Content align="end" className="w-auto">
      <DropdownMenu.Item
        variant="danger"
        onClick={() => {
          onCancelInvitation(invitationId);
        }}
        icon={UserMinusIcon}
      >
        Cancel invitation
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu>
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
  <DropdownMenu>
    <ActionsTrigger isPending={isPending} label="Member actions" />
    <DropdownMenu.Content align="end" className="w-auto">
      <DropdownMenu.Group>
        <DropdownMenu.Item
          variant="danger"
          onClick={() => {
            onRemove(memberId);
          }}
          icon={UserMinusIcon}
        >
          Remove member
        </DropdownMenu.Item>
      </DropdownMenu.Group>
    </DropdownMenu.Content>
  </DropdownMenu>
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
