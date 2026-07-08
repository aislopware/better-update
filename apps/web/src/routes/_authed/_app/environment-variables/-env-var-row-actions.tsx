import { Button } from "@better-update/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@better-update/ui/components/ui/dropdown-menu";
import { EllipsisVerticalIcon, EyeIcon, PencilIcon, TagIcon, Trash2Icon } from "lucide-react";
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
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground/70 hover:text-foreground"
              aria-label={`Actions for ${envVar.key}`}
            />
          }
        >
          <EllipsisVerticalIcon strokeWidth={2} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => {
              setOpenDialog("details");
            }}
          >
            <TagIcon strokeWidth={2} />
            <span>Edit details</span>
          </DropdownMenuItem>
          {vault ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  setOpenDialog("reveal");
                }}
              >
                <EyeIcon strokeWidth={2} />
                <span>Reveal value</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setOpenDialog("edit");
                }}
              >
                <PencilIcon strokeWidth={2} />
                <span>Edit value</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => {
                  setOpenDialog("delete");
                }}
              >
                <Trash2Icon strokeWidth={2} />
                <span>Delete</span>
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
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
