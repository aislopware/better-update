import { DropdownMenu } from "@better-update/ui/components/dropdown";
import { FolderIcon, UserMinusIcon } from "@phosphor-icons/react";

import { RowActionsMenu } from "../../../lib/data-table";

import type { ManageProjectsTarget } from "./-member-projects-cell";
import type { Row } from "./-members-row";

const InvitationActions = ({
  invitationId,
  isPending,
  onCancelInvitation,
}: {
  invitationId: string;
  isPending: boolean;
  onCancelInvitation: (invitationId: string) => void;
}) => (
  <RowActionsMenu label="Invitation actions" isPending={isPending}>
    <DropdownMenu.Item
      variant="danger"
      onClick={() => {
        onCancelInvitation(invitationId);
      }}
      icon={UserMinusIcon}
    >
      Cancel invitation
    </DropdownMenu.Item>
  </RowActionsMenu>
);

const ActiveMemberActions = ({
  row,
  isPending,
  showManageProjects,
  showRemove,
  onManageProjects,
  onRemove,
}: {
  row: Row;
  isPending: boolean;
  showManageProjects: boolean;
  showRemove: boolean;
  onManageProjects: (target: ManageProjectsTarget) => void;
  onRemove: (memberId: string) => void;
}) => (
  <RowActionsMenu label="Member actions" isPending={isPending}>
    <DropdownMenu.Group>
      {showManageProjects ? (
        <DropdownMenu.Item
          onClick={() => {
            onManageProjects({ id: row.id, name: row.name });
          }}
          icon={FolderIcon}
        >
          Manage projects
        </DropdownMenu.Item>
      ) : null}
      {showRemove ? (
        <DropdownMenu.Item
          variant="danger"
          onClick={() => {
            onRemove(row.id);
          }}
          icon={UserMinusIcon}
        >
          Remove member
        </DropdownMenu.Item>
      ) : null}
    </DropdownMenu.Group>
  </RowActionsMenu>
);

export const MemberRowActions = ({
  row,
  currentUserId,
  canRemoveMembers,
  canManageProjects,
  isPending,
  onRemove,
  onCancelInvitation,
  onManageProjects,
}: {
  row: Row;
  currentUserId: string;
  canRemoveMembers: boolean;
  canManageProjects: boolean;
  isPending: boolean;
  onRemove: (memberId: string) => void;
  onCancelInvitation: (invitationId: string) => void;
  onManageProjects: (target: ManageProjectsTarget) => void;
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
  // Remove, member:update for Manage projects) so a partial-capability holder
  // never sees an action the server would 403. The owner's own membership is
  // never managed here: they cannot be removed (last-owner guard).
  if (row.role === "owner") {
    return null;
  }
  const isSelf = row.userId === currentUserId;
  const showRemove = canRemoveMembers && !isSelf;
  // Admins are implicit maintainers everywhere, so there are no memberships of
  // theirs to choose — only a plain member's projects are editable.
  const showManageProjects = canManageProjects && row.role === "member";
  if (!showRemove && !showManageProjects) {
    return null;
  }

  return (
    <ActiveMemberActions
      row={row}
      isPending={isPending}
      showManageProjects={showManageProjects}
      showRemove={showRemove}
      onManageProjects={onManageProjects}
      onRemove={onRemove}
    />
  );
};
