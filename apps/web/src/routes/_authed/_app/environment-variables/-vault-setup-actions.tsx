import {
  accountKeysQueryOptions,
  envVaultWrapsQueryOptions,
} from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/button";
import { Link } from "@better-update/ui/components/link";
import { Loader } from "@better-update/ui/components/loader";
import { useQuery } from "@tanstack/react-query";

import { meQueryOptions } from "../../../../queries/org";
import { EnrollAccountKeyDialog } from "../account/-account-key-dialogs";
import { EnvVaultUnlockDialog } from "./-env-vault-unlock-dialog";

import type { UnlockedEnvVault } from "../../../../lib/env-vault/use-env-vault";

/**
 * The locked-state entry point on the vault origin. Walks a new user through the
 * three things needed to unlock the env vault, branching on no-step-up reads:
 *   1. no account key  → "Set up vault access" (self-enroll, picks own passphrase)
 *   2. account key, not yet an env recipient → wait for an admin to grant access
 *   3. account key + env wrap → the unlock dialog (passkey step-up + passphrase)
 * Rendered only when `vault.enabled` (host-gated upstream) and still locked.
 */
export const VaultSetupActions = ({
  orgId,
  onUnlocked,
}: {
  orgId: string;
  onUnlocked: (vault: UnlockedEnvVault) => void;
}) => {
  const meQuery = useQuery(meQueryOptions());
  const accountKeysQuery = useQuery(accountKeysQueryOptions(orgId));
  const wrapsQuery = useQuery(envVaultWrapsQueryOptions(orgId));

  const userId = meQuery.data?.user?.id;
  const myAccountKey =
    userId === undefined
      ? undefined
      : accountKeysQuery.data?.items.find((key) => key.userId === userId);

  if (meQuery.isPending || accountKeysQuery.isPending) {
    return (
      <Button variant="secondary" disabled>
        <Loader size="sm" data-icon="inline-start" />
        Checking access…
      </Button>
    );
  }

  if (myAccountKey === undefined) {
    // The dialog invalidates `accountKeysQueryKey` on success, which refetches this
    // query and advances the machine — no explicit callback needed.
    return <EnrollAccountKeyDialog orgId={orgId} />;
  }

  // The account key exists; it can only unlock once an admin wraps the env-vault
  // key to it. While that wrap is absent, surface a clear waiting state (the
  // browser cannot self-grant — it holds no vault key).
  const hasEnvWrap = wrapsQuery.data?.recipients.some(
    (recipient) =>
      recipient.recipientKind === "account" && recipient.recipientId === myAccountKey.id,
  );
  if (hasEnvWrap === false) {
    return (
      <p className="text-kumo-subtle text-sm">
        Account key enrolled — waiting for an admin to grant env-vault access.{" "}
        <Link href="/account/passkeys">Add a passkey</Link> while you wait.
      </p>
    );
  }

  return <EnvVaultUnlockDialog orgId={orgId} onUnlocked={onUnlocked} />;
};
