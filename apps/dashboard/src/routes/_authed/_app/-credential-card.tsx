import { getApiError } from "@better-update/api-client";
import { activateCredential, deleteCredential } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@better-update/ui/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@better-update/ui/components/ui/dropdown-menu";
import { Delete02Icon, MoreVerticalIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import type { Credential } from "@better-update/api";

import { DISTRIBUTION_LABELS, TYPE_LABELS } from "./-credential-helpers";

const getExpiryBadge = (expiresAt: string | null) => {
  if (!expiresAt) {
    return null;
  }
  const now = Date.now();
  const expiry = new Date(expiresAt).getTime();
  const daysUntilExpiry = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

  if (daysUntilExpiry <= 0) {
    return <Badge variant="destructive">Expired</Badge>;
  }
  if (daysUntilExpiry <= 7) {
    return <Badge variant="destructive">Expires in {daysUntilExpiry}d</Badge>;
  }
  if (daysUntilExpiry <= 30) {
    return <Badge variant="secondary">Expires in {daysUntilExpiry}d</Badge>;
  }
  return null;
};

export const CredentialCard = ({
  credential,
  orgId,
}: {
  credential: typeof Credential.Type;
  orgId: string;
}) => {
  const queryClient = useQueryClient();

  const handleActivate = async () => {
    // eslint-disable-next-line functional/no-try-statements -- imperative shell error handling
    try {
      await activateCredential(credential.id);
      toast.success("Credential activated");
      await queryClient.invalidateQueries({ queryKey: ["org", orgId, "credentials"] });
    } catch (error) {
      toast.error(getApiError(error));
    }
  };

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    // eslint-disable-next-line functional/no-try-statements -- imperative shell error handling
    try {
      await deleteCredential(credential.id);
      toast.success("Credential deleted");
      setDeleteOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["org", orgId, "credentials"] });
    } catch (error) {
      toast.error(getApiError(error));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-medium">{credential.name}</CardTitle>
        <div className="flex items-center gap-2">
          {credential.isActive && (
            <Badge variant="default">
              <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} className="mr-1 size-3" />
              Active
            </Badge>
          )}
          {getExpiryBadge(credential.expiresAt)}
          <DropdownMenu>
            <DropdownMenuTrigger>
              <Button variant="ghost" size="icon-sm">
                <HugeiconsIcon icon={MoreVerticalIcon} strokeWidth={2} className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!credential.isActive && (
                <DropdownMenuItem onClick={handleActivate}>
                  <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} className="size-4" />
                  <span>Set as active</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => {
                  setDeleteOpen(true);
                }}
              >
                <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-4" />
                <span>Delete</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete credential?</DialogTitle>
                <DialogDescription>
                  This will permanently delete &ldquo;{credential.name}&rdquo; and its encrypted
                  data. This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setDeleteOpen(false);
                  }}
                >
                  Cancel
                </Button>
                <Button variant="destructive" disabled={isDeleting} onClick={handleDelete}>
                  {isDeleting ? "Deleting..." : "Delete"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{credential.platform === "ios" ? "iOS" : "Android"}</Badge>
          <Badge variant="secondary">{TYPE_LABELS[credential.type] ?? credential.type}</Badge>
          {credential.distribution && (
            <Badge variant="secondary">
              {DISTRIBUTION_LABELS[credential.distribution] ?? credential.distribution}
            </Badge>
          )}
          <span className="text-muted-foreground text-xs">
            {credential.projectId ? "Project-scoped" : "Organization-wide"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
};
