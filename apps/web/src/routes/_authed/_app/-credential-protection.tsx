import {
  appleTeamsQueryKey,
  googleServiceAccountKeysQueryKey,
  setAppleTeamProtection,
  setGoogleServiceAccountKeyProtection,
} from "@better-update/api-client/react";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";

import type { AppleTeamItem, GoogleServiceAccountKeyItem } from "@better-update/api-client/react";

import { useApiMutation } from "../../../lib/use-api-mutation";
import { ProtectionCell } from "./-credential-cells";
import { formatAppleTeamLabel } from "./-credentials-utils";

// Protecting a team cascades to every child credential (GITLAB-RBAC-SPEC §3b):
// invalidating the teams query refreshes both this switch and the inherited
// "Protected (via team)" badges in the child tables.
export const AppleTeamProtectionSwitch = ({
  orgId,
  team,
  canManage,
}: {
  orgId: string;
  team: AppleTeamItem;
  canManage: boolean;
}) => {
  const queryClient = useQueryClient();
  const protectionMutation = useApiMutation({
    mutationFn: async (next: boolean) => setAppleTeamProtection(team.id, next),
    onSuccess: async (_result, next) => {
      toastManager.add({
        title: next ? "Apple team protected" : "Apple team unprotected",
        type: "success",
      });
      await queryClient.invalidateQueries({ queryKey: appleTeamsQueryKey(orgId) });
    },
  });
  return (
    <ProtectionCell
      label={`Protect ${formatAppleTeamLabel(team)}`}
      checked={team.protected}
      canManage={canManage}
      isPending={protectionMutation.isPending}
      onToggle={(next) => {
        protectionMutation.mutate(next);
      }}
    />
  );
};

// Per-row toggle (no parent to inherit from, unlike Apple teams).
export const GsaKeyProtectionSwitch = ({
  orgId,
  gsaKey,
  canManage,
}: {
  orgId: string;
  gsaKey: GoogleServiceAccountKeyItem;
  canManage: boolean;
}) => {
  const queryClient = useQueryClient();
  const protectionMutation = useApiMutation({
    mutationFn: async (next: boolean) => setGoogleServiceAccountKeyProtection(gsaKey.id, next),
    onSuccess: async (_result, next) => {
      toastManager.add({
        title: next ? "Service account key protected" : "Service account key unprotected",
        type: "success",
      });
      await queryClient.invalidateQueries({ queryKey: googleServiceAccountKeysQueryKey(orgId) });
    },
  });
  return (
    <ProtectionCell
      label={`Protect ${gsaKey.clientEmail}`}
      checked={gsaKey.protected}
      canManage={canManage}
      isPending={protectionMutation.isPending}
      onToggle={(next) => {
        protectionMutation.mutate(next);
      }}
    />
  );
};
