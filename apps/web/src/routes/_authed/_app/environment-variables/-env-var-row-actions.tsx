import { Button } from "@better-update/ui/components/button";
import { DropdownMenu } from "@better-update/ui/components/dropdown";
import {
  DotsThreeVerticalIcon,
  EyeIcon,
  PencilSimpleIcon,
  TagIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useState } from "react";

import type { EnvVar } from "@better-update/api";

import { EnvVarDeleteDialog } from "./-env-var-delete-dialog";
import { EnvVarDetailsDialog } from "./-env-var-details-dialog";
import { EnvVarEditDialog } from "./-env-var-edit-dialog";
import { EnvVarRevealDialog } from "./-env-var-reveal-dialog";

import type { UnlockedEnvVault } from "../../../../lib/env-vault/use-env-vault";

type OpenDialog = "reveal" | "edit" | "details" | "delete" | null;

/**
 * Per-row actions for the env-vars table. "Edit details" (label/description) is
 * always available — it edits non-secret documentation, so it needs no vault. The
 * value actions (reveal / edit value / delete) touch the encrypted value and only
 * appear when the env vault is unlocked (`vault` present). Dialog open-state is
 * lifted here (menu items just set it), per the Menu→Dialog convention so dialogs
 * aren't unmounted with the menu.
 */
export const EnvVarRowActions = ({
  envVar,
  orgId,
  vault,
  invalidate,
}: {
  envVar: EnvVar;
  orgId: string;
  vault: UnlockedEnvVault | null;
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
      <DropdownMenu>
        <DropdownMenu.Trigger
          render={
            <Button
              variant="ghost"
              shape="square"
              className="text-muted-foreground/70 hover:text-foreground"
              aria-label={`Actions for ${envVar.key}`}
            />
          }
        >
          <DotsThreeVerticalIcon weight="bold" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">
          <DropdownMenu.Item
            onClick={() => {
              setOpenDialog("details");
            }}
            icon={TagIcon}
          >
            Edit details
          </DropdownMenu.Item>
          {vault ? (
            <>
              <DropdownMenu.Separator />
              <DropdownMenu.Item
                onClick={() => {
                  setOpenDialog("reveal");
                }}
                icon={EyeIcon}
              >
                Reveal value
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onClick={() => {
                  setOpenDialog("edit");
                }}
                icon={PencilSimpleIcon}
              >
                Edit value
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item
                variant="danger"
                onClick={() => {
                  setOpenDialog("delete");
                }}
                icon={TrashIcon}
              >
                Delete
              </DropdownMenu.Item>
            </>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu>
      <EnvVarDetailsDialog
        envVar={envVar}
        invalidate={invalidate}
        open={openDialog === "details"}
        onOpenChange={handleClose}
      />
      {vault ? (
        <>
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
      ) : null}
    </>
  );
};
