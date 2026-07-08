import {
  appleDistributionCertificatesQueryKey,
  applePassTypeCertificatesQueryKey,
  applePayCertificatesQueryKey,
  applePushCertificatesQueryKey,
  applePushKeysQueryKey,
  appleTeamsQueryKey,
  ascApiKeysQueryKey,
  googleServiceAccountKeysQueryKey,
  setAppleDistributionCertificateProtection,
  setApplePassTypeCertificateProtection,
  setApplePayCertificateProtection,
  setApplePushCertificateProtection,
  setApplePushKeyProtection,
  setAppleTeamProtection,
  setAscApiKeyProtection,
  setGoogleServiceAccountKeyProtection,
} from "@better-update/api-client/react";
import { toast } from "@better-update/ui/components/ui/sonner";
import { useQueryClient } from "@tanstack/react-query";

import type { AppleTeamItem, GoogleServiceAccountKeyItem } from "@better-update/api-client/react";

import { useApiMutation } from "../../../lib/use-api-mutation";
import { ProtectionCell } from "./-credential-cells";
import { formatAppleTeamLabel } from "./-credentials-utils";

// Shared mutation + cell wiring for every protection toggle (GITLAB-RBAC-SPEC
// §3b): mutate → toast → invalidate the owning list query.
const ProtectionSwitch = ({
  label,
  toastLabel,
  checked,
  canManage,
  queryKey,
  setProtection,
}: {
  label: string;
  toastLabel: string;
  checked: boolean;
  canManage: boolean;
  queryKey: readonly unknown[];
  setProtection: (next: boolean) => Promise<unknown>;
}) => {
  const queryClient = useQueryClient();
  const protectionMutation = useApiMutation({
    mutationFn: setProtection,
    onSuccess: async (_result, next) => {
      toast.success(next ? `${toastLabel} protected` : `${toastLabel} unprotected`);
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  return (
    <ProtectionCell
      label={label}
      checked={checked}
      canManage={canManage}
      isPending={protectionMutation.isPending}
      onToggle={(next) => {
        protectionMutation.mutate(next);
      }}
    />
  );
};

// The team flag gates team-level interactions only (creating credentials
// under the team, devices — GITLAB-RBAC-SPEC §3b); existing child
// credentials carry their own flag and are unaffected by this toggle.
export const AppleTeamProtectionSwitch = ({
  orgId,
  team,
  canManage,
}: {
  orgId: string;
  team: AppleTeamItem;
  canManage: boolean;
}) => (
  <ProtectionSwitch
    label={`Protect ${formatAppleTeamLabel(team)}`}
    toastLabel="Apple team"
    checked={team.protected}
    canManage={canManage}
    queryKey={appleTeamsQueryKey(orgId)}
    setProtection={async (next) => setAppleTeamProtection(team.id, next)}
  />
);

// Per-row toggle (no parent to inherit from, unlike Apple teams).
export const GsaKeyProtectionSwitch = ({
  orgId,
  gsaKey,
  canManage,
}: {
  orgId: string;
  gsaKey: GoogleServiceAccountKeyItem;
  canManage: boolean;
}) => (
  <ProtectionSwitch
    label={`Protect ${gsaKey.clientEmail}`}
    toastLabel="Service account key"
    checked={gsaKey.protected}
    canManage={canManage}
    queryKey={googleServiceAccountKeysQueryKey(orgId)}
    setProtection={async (next) => setGoogleServiceAccountKeyProtection(gsaKey.id, next)}
  />
);

const APPLE_CHILD_PROTECTION = {
  distributionCertificate: {
    toastLabel: "Distribution certificate",
    setProtection: setAppleDistributionCertificateProtection,
    queryKeyOf: appleDistributionCertificatesQueryKey,
  },
  pushKey: {
    toastLabel: "Push key",
    setProtection: setApplePushKeyProtection,
    queryKeyOf: applePushKeysQueryKey,
  },
  pushCertificate: {
    toastLabel: "Push certificate",
    setProtection: setApplePushCertificateProtection,
    queryKeyOf: applePushCertificatesQueryKey,
  },
  payCertificate: {
    toastLabel: "Apple Pay certificate",
    setProtection: setApplePayCertificateProtection,
    queryKeyOf: applePayCertificatesQueryKey,
  },
  passTypeCertificate: {
    toastLabel: "Pass Type ID certificate",
    setProtection: setApplePassTypeCertificateProtection,
    queryKeyOf: applePassTypeCertificatesQueryKey,
  },
  ascApiKey: {
    toastLabel: "ASC API key",
    setProtection: setAscApiKeyProtection,
    queryKeyOf: ascApiKeysQueryKey,
  },
} as const;

export type AppleChildProtectionKind = keyof typeof APPLE_CHILD_PROTECTION;

// Per-credential toggle (GITLAB-RBAC-SPEC §3b): the row's own flag is the
// whole gate for an existing credential — the team's flag only guards
// team-level interactions and is snapshotted onto new rows at creation.
export const AppleChildProtectionSwitch = ({
  orgId,
  kind,
  id,
  label,
  isProtected,
  canManage,
}: {
  orgId: string;
  kind: AppleChildProtectionKind;
  id: string;
  label: string;
  isProtected: boolean;
  canManage: boolean;
}) => {
  const config = APPLE_CHILD_PROTECTION[kind];
  return (
    <ProtectionSwitch
      label={`Protect ${label}`}
      toastLabel={config.toastLabel}
      checked={isProtected}
      canManage={canManage}
      queryKey={config.queryKeyOf(orgId)}
      setProtection={async (next) => config.setProtection(id, next)}
    />
  );
};
