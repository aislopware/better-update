import { Button } from "@better-update/ui/components/ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@better-update/ui/components/ui/menu";
import { EllipsisVerticalIcon, EyeIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import type { EnvVar } from "@better-update/api";

import { EnvVarDeleteDialog } from "./-env-var-delete-dialog";
import { EnvVarEditDialog } from "./-env-var-edit-dialog";
import { EnvVarRevealDialog } from "./-env-var-reveal-dialog";

import type { UnlockedEnvVault } from "../../../../lib/env-vault/use-env-vault";

type OpenDialog = "reveal" | "edit" | "delete" | null;

/**
 * Per-row actions for the env-vars table when the env vault is unlocked: reveal,
 * edit, and delete. Dialog open-state is lifted here (the menu items just set it),
 * following the Menu→Dialog convention so dialogs aren't unmounted with the menu.
 */
export const EnvVarRowActions = ({
  envVar,
  orgId,
  vault,
  invalidate,
}: {
  envVar: EnvVar;
  orgId: string;
  vault: UnlockedEnvVault;
  invalidate: () => Promise<void>;
}) => {
  const [openDialog, setOpenDialog] = useState<OpenDialog>(null);
  const handleClose = (next: boolean) => {
    if (!next) {
      setOpenDialog(null);
    }
  };

  return (
    <>
      <Menu>
        <MenuTrigger
          render={<Button variant="ghost" size="icon" aria-label={`Actions for ${envVar.key}`} />}
        >
          <EllipsisVerticalIcon strokeWidth={2} />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem
            onClick={() => {
              setOpenDialog("reveal");
            }}
          >
            <EyeIcon strokeWidth={2} />
            <span>Reveal value</span>
          </MenuItem>
          <MenuItem
            onClick={() => {
              setOpenDialog("edit");
            }}
          >
            <PencilIcon strokeWidth={2} />
            <span>Edit value</span>
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            variant="destructive"
            onClick={() => {
              setOpenDialog("delete");
            }}
          >
            <Trash2Icon strokeWidth={2} />
            <span>Delete</span>
          </MenuItem>
        </MenuPopup>
      </Menu>
      <EnvVarRevealDialog
        envVar={envVar}
        orgId={orgId}
        vault={vault}
        open={openDialog === "reveal"}
        onOpenChange={handleClose}
      />
      <EnvVarEditDialog
        envVar={envVar}
        orgId={orgId}
        vault={vault}
        invalidate={invalidate}
        open={openDialog === "edit"}
        onOpenChange={handleClose}
      />
      <EnvVarDeleteDialog
        envVar={envVar}
        invalidate={invalidate}
        open={openDialog === "delete"}
        onOpenChange={handleClose}
      />
    </>
  );
};
