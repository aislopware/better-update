import {
  accountKeysQueryKey,
  accountKeysQueryOptions,
  addEnvWrap,
  envVaultWrapsQueryKey,
  envVaultWrapsQueryOptions,
} from "@better-update/api-client/react";
import { wrapVaultKey } from "@better-update/credentials-crypto";
import { toBase64 } from "@better-update/encoding";
import { Button } from "@better-update/ui/components/button";
import { Loader } from "@better-update/ui/components/loader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/table";
import { toast } from "@better-update/ui/components/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { TablePanel } from "../../../components/table-panel";
import { CopyableMono } from "../../../lib/copy-button";
import { PRIMARY_COLUMN_CLASS } from "../../../lib/data-table";
import { useEnvVault } from "../../../lib/env-vault/use-env-vault";
import { RelativeTime } from "../../../lib/relative-time";
import { useApiMutation } from "../../../lib/use-api-mutation";
import { EnvVaultUnlockDialog } from "./environment-variables/-env-vault-unlock-dialog";

import type { UnlockedEnvVault } from "../../../lib/env-vault/use-env-vault";

interface PendingAccountKey {
  readonly id: string;
  readonly agePublicKey: string;
  readonly fingerprint: string;
  readonly createdAt: string;
}

const GrantButton = ({
  orgId,
  unlocked,
  target,
}: {
  orgId: string;
  unlocked: UnlockedEnvVault;
  target: PendingAccountKey;
}) => {
  const queryClient = useQueryClient();
  const grantMutation = useApiMutation({
    // Wrap the unlocked env-vault key to the target's PUBLIC age recipient — an age
    // blob only the target's passphrase-sealed key can open. Byte-identical to the
    // CLI self-link; the server's admin-grant branch gates it on vaultAccess:create.
    mutationFn: async () => {
      const wrapped = await wrapVaultKey({
        vaultKey: unlocked.vaultKey,
        recipient: target.agePublicKey,
      });
      return addEnvWrap({
        envVaultVersion: unlocked.envVaultVersion,
        wrap: {
          recipientKind: "account",
          recipientId: target.id,
          wrappedKey: toBase64(wrapped),
        },
      });
    },
    onSuccess: async () => {
      toast.success("Env access granted");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: envVaultWrapsQueryKey(orgId) }),
        queryClient.invalidateQueries({ queryKey: accountKeysQueryKey(orgId) }),
      ]);
    },
  });

  return (
    <Button
      variant="primary"
      size="sm"
      onClick={() => {
        grantMutation.mutate();
      }}
      loading={grantMutation.isPending}
    >
      Grant env access
    </Button>
  );
};

const PendingGrantsTable = ({
  orgId,
  unlocked,
  pending,
}: {
  orgId: string;
  unlocked: UnlockedEnvVault;
  pending: readonly PendingAccountKey[];
}) => (
  <Table className="[&_th]:whitespace-nowrap">
    <TableHeader>
      <TableRow>
        <TableHead className={PRIMARY_COLUMN_CLASS}>Account key</TableHead>
        <TableHead>Enrolled</TableHead>
        <TableHead className="text-right">Action</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {pending.map((key) => (
        <TableRow key={key.id}>
          <TableCell className={PRIMARY_COLUMN_CLASS}>
            <CopyableMono value={key.fingerprint} label="Fingerprint" />
          </TableCell>
          <TableCell className="text-kumo-subtle">
            <RelativeTime value={key.createdAt} />
          </TableCell>
          <TableCell className="text-right">
            <GrantButton orgId={orgId} unlocked={unlocked} target={key} />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

const PendingGrants = ({ orgId, unlocked }: { orgId: string; unlocked: UnlockedEnvVault }) => {
  const accountKeysQuery = useQuery(accountKeysQueryOptions(orgId));
  const wrapsQuery = useQuery(envVaultWrapsQueryOptions(orgId));

  if (accountKeysQuery.isPending || wrapsQuery.isPending) {
    return (
      <div className="text-kumo-subtle flex items-center gap-2 p-4 text-sm">
        <Loader size="sm" /> Loading enrolled account keys…
      </div>
    );
  }

  const granted = new Set(
    (wrapsQuery.data?.recipients ?? [])
      .filter((recipient) => recipient.recipientKind === "account")
      .map((recipient) => recipient.recipientId),
  );
  const pending: PendingAccountKey[] = (accountKeysQuery.data?.items ?? [])
    .filter((key) => !granted.has(key.id))
    .map((key) => ({
      id: key.id,
      agePublicKey: key.agePublicKey,
      fingerprint: key.fingerprint,
      createdAt: key.createdAt,
    }));

  if (pending.length === 0) {
    return (
      <p className="text-kumo-subtle p-4 text-sm">
        Every enrolled member already has env-vault access.
      </p>
    );
  }

  return <PendingGrantsTable orgId={orgId} unlocked={unlocked} pending={pending} />;
};

/**
 * Admin grant of env-vault access from the browser (vault origin only). An admin
 * who has unlocked their own env vault (so they hold the env-vault key) can wrap it
 * to a member's pending account key in one click — no CLI. Renders nothing on the
 * dashboard origin; the credentials vault stays CLI-only.
 */
export const VaultAccessGrant = ({ orgId }: { orgId: string }) => {
  const vault = useEnvVault(orgId);
  if (!vault.enabled) {
    return null;
  }

  // One panel, like the two vaults above it: this used to be a loose heading and
  // a paragraph floating under two framed lists, which read as leftovers rather
  // than as the third section of the page.
  return (
    <TablePanel
      title="Env-vault access"
      description="Grant a member access by wrapping the env-vault key to their account key — you must hold the key yourself to do it."
      actions={
        vault.unlocked ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              vault.lock();
            }}
          >
            Lock
          </Button>
        ) : (
          <EnvVaultUnlockDialog
            orgId={orgId}
            onUnlocked={(unlockedVault) => {
              vault.onUnlocked(unlockedVault);
            }}
          />
        )
      }
    >
      {vault.unlocked ? (
        <div className="max-h-[40vh] overflow-y-auto">
          <PendingGrants orgId={orgId} unlocked={vault.unlocked} />
        </div>
      ) : (
        <p className="text-kumo-subtle m-0 px-4 py-3 text-sm">
          The env vault is locked. Unlock it to see which enrolled members are still waiting for
          access.
        </p>
      )}
    </TablePanel>
  );
};
