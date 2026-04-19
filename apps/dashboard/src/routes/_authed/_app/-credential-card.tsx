import {
  activateCredential,
  credentialsQueryKey,
  deleteCredential,
} from "@better-update/api-client/react";
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
import { useQueryClient } from "@tanstack/react-query";
import { Trash2Icon, EllipsisVerticalIcon, CheckIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { Credential } from "@better-update/api";

import { useApiMutation } from "../../../lib/use-api-mutation";
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
  const [deleteOpen, setDeleteOpen] = useState(false);
  const activateCredentialMutation = useApiMutation({
    mutationFn: async () => activateCredential(credential.id),
    onSuccess: async () => {
      toast.success("Credential activated");
      await queryClient.invalidateQueries({
        queryKey: credentialsQueryKey(orgId),
      });
    },
  });
  const deleteCredentialMutation = useApiMutation({
    mutationFn: async () => deleteCredential(credential.id),
    onSuccess: async () => {
      toast.success("Credential deleted");
      setDeleteOpen(false);
      await queryClient.invalidateQueries({
        queryKey: credentialsQueryKey(orgId),
      });
    },
  });

  const handleActivate = () => {
    activateCredentialMutation.mutate();
  };

  const handleDelete = () => {
    deleteCredentialMutation.mutate();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-medium">{credential.name}</CardTitle>
        <div className="flex items-center gap-2">
          {credential.isActive && (
            <Badge variant="default">
              <CheckIcon strokeWidth={2} className="mr-1 size-3" />
              Active
            </Badge>
          )}
          {getExpiryBadge(credential.expiresAt)}
          <DropdownMenu>
            <DropdownMenuTrigger>
              <Button variant="ghost" size="icon-sm">
                <EllipsisVerticalIcon strokeWidth={2} className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!credential.isActive && (
                <DropdownMenuItem onClick={handleActivate}>
                  <CheckIcon strokeWidth={2} className="size-4" />
                  <span>Set as active</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => {
                  setDeleteOpen(true);
                }}
              >
                <Trash2Icon strokeWidth={2} className="size-4" />
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
                  disabled={deleteCredentialMutation.isPending}
                  onClick={() => {
                    setDeleteOpen(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={deleteCredentialMutation.isPending}
                  onClick={handleDelete}
                >
                  {deleteCredentialMutation.isPending ? "Deleting..." : "Delete"}
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
