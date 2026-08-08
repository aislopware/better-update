import { DropdownMenu } from "@better-update/ui/components/dropdown";
import { PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import { useState } from "react";

import type { BranchItem } from "@better-update/api-client/react";

import { DeleteBranchDialog } from "../-delete-branch-dialog";
import { RenameBranchDialog } from "../-rename-branch-dialog";
import { RowActionsMenu } from "../../../../../../lib/data-table";

/**
 * Row actions for the branches list, in the same ⋮ menu every other list uses.
 *
 * Both dialogs' open-state is lifted out of the menu, per the Menu→Dialog
 * convention: picking an item unmounts the menu, and an uncontrolled dialog
 * would go with it.
 *
 * Built-in branches are part of the project's shape rather than something
 * someone added, so they neither rename nor delete and get no menu at all —
 * the column keeps its width from the rows that do have one.
 */
export const BranchRowActions = ({
  branch,
  orgId,
  projectId,
}: {
  branch: BranchItem;
  orgId: string;
  projectId: string;
}) => {
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  if (branch.isBuiltin) {
    return null;
  }

  return (
    <>
      <RowActionsMenu label="Branch actions">
        <DropdownMenu.Item
          icon={PencilSimpleIcon}
          onClick={() => {
            setIsRenameOpen(true);
          }}
        >
          Rename branch
        </DropdownMenu.Item>
        <DropdownMenu.Item
          variant="danger"
          icon={TrashIcon}
          onClick={() => {
            setIsDeleteOpen(true);
          }}
        >
          Delete branch
        </DropdownMenu.Item>
      </RowActionsMenu>
      <RenameBranchDialog
        branch={branch}
        orgId={orgId}
        projectId={projectId}
        open={isRenameOpen}
        onOpenChange={setIsRenameOpen}
      />
      <DeleteBranchDialog
        branch={branch}
        orgId={orgId}
        projectId={projectId}
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
      />
    </>
  );
};
