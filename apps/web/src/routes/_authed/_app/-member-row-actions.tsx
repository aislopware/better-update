import { Button } from "@better-update/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@better-update/ui/components/ui/dropdown-menu";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { EllipsisVerticalIcon, UserMinusIcon } from "lucide-react";

import type { Row } from "./-members-row";

const ActionsTrigger = ({ isPending, label }: { isPending: boolean; label?: string }) => (
  <DropdownMenuTrigger
    render={
      <Button
        variant="ghost"
        size="icon"
        className="text-muted-foreground/70 hover:text-foreground"
        disabled={isPending}
        aria-label={label}
      />
    }
  >
    {isPending ? <Spinner /> : <EllipsisVerticalIcon strokeWidth={2} />}
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
    <DropdownMenuContent align="end">
      <DropdownMenuItem
        variant="destructive"
        onClick={() => {
          onCancelInvitation(invitationId);
        }}
      >
        <UserMinusIcon strokeWidth={2} />
        <span>Cancel invitation</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
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
    <DropdownMenuContent align="end">
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
