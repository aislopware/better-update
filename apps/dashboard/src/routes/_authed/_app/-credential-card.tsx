import { getApiError } from "@better-update/api-client";
import { activateCredential, deleteCredential } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@better-update/ui/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@better-update/ui/components/ui/dropdown-menu";
import { Delete02Icon, MoreVerticalIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { Credential } from "@better-update/api";

const TYPE_LABELS: Record<string, string> = {
  "distribution-certificate": "Distribution Certificate",
  "provisioning-profile": "Provisioning Profile",
  "push-key": "Push Key",
  keystore: "Keystore",
  "play-service-account": "Service Account",
};

const DISTRIBUTION_LABELS: Record<string, string> = {
  "ad-hoc": "Ad Hoc",
  "app-store": "App Store",
  development: "Development",
  enterprise: "Enterprise",
  "play-store": "Play Store",
  direct: "Direct",
};

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

  const handleDelete = async () => {
    // eslint-disable-next-line functional/no-try-statements -- imperative shell error handling
    try {
      await deleteCredential(credential.id);
      toast.success("Credential deleted");
      await queryClient.invalidateQueries({ queryKey: ["org", orgId, "credentials"] });
    } catch (error) {
      toast.error(getApiError(error));
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
              <DropdownMenuItem className="text-destructive" onClick={handleDelete}>
                <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-4" />
                <span>Delete</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
