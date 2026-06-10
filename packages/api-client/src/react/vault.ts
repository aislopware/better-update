import { queryOptions } from "@tanstack/react-query";
import { Effect } from "effect";

import { runApi } from "../index";

import type { VaultRecipientsResult } from "./types";

export const encryptionKeysQueryKey = (orgId: string) => ["org", orgId, "encryption-keys"] as const;

export const encryptionKeysQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: encryptionKeysQueryKey(orgId),
    queryFn: async ({ signal }) => runApi((api) => api.userEncryptionKeys.list(), signal),
    staleTime: 30_000,
  });

/** Sentinel for an org whose vault has not been bootstrapped yet (no CLI upload). */
const UNINITIALIZED_VAULT: VaultRecipientsResult = { vaultVersion: 0, recipients: [] };

export const orgVaultQueryKey = (orgId: string) => ["org", orgId, "vault"] as const;

/**
 * The org vault row (version + rotation-pending state). `null` until the vault is
 * bootstrapped by the first CLI upload (server replies NotFound). The
 * `rotationPending` flag drives the "rotation required" banner on the access view.
 */
export const orgVaultQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: orgVaultQueryKey(orgId),
    queryFn: async ({ signal }) =>
      runApi(
        (api) => api.orgVault.get().pipe(Effect.catchTag("NotFound", () => Effect.succeed(null))),
        signal,
      ),
    staleTime: 30_000,
  });

export const vaultRecipientsQueryKey = (orgId: string) =>
  ["org", orgId, "vault-recipients"] as const;

export const vaultRecipientsQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: vaultRecipientsQueryKey(orgId),
    queryFn: async ({ signal }) =>
      runApi(
        (api) =>
          // The vault is created lazily by the first CLI upload; until then the
          // server replies NotFound. For a read-only access view that just means
          // "no recipients yet", so fold it into an empty result, not an error.
          api.orgVault
            .listWraps()
            .pipe(Effect.catchTag("NotFound", () => Effect.succeed(UNINITIALIZED_VAULT))),
        signal,
      ),
    staleTime: 30_000,
  });
