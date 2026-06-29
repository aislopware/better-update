import { queryOptions } from "@tanstack/react-query";

import type { AddEnvVaultWrapBody, RegisterAccountKeyBody } from "@better-update/api";

import { runApi } from "../index";

// Data layer for the browser env-vault unlock (P4). All three are part of the
// "2FA before web env access" flow: the caller completes a WebAuthn step-up
// (`stepUpPasskey`), then downloads its passphrase-sealed account-key escrow
// (`getAccountKeyEscrow`, step-up-gated server-side) and the env-vault key wrapped
// to that account key (`getEnvVaultAccountWrap`) to unwrap the env vault locally.
// See apps/web env-vault unlock lib for the orchestration.

/** Record a fresh WebAuthn step-up for this browser session (assertion JSON-stringified). */
export const stepUpPasskey = async (assertionJson: string) =>
  runApi((api) => api.webVault.stepUp({ payload: { assertionJson } }));

/** The caller's passphrase-sealed account-key escrow (requires a fresh step-up). */
export const getAccountKeyEscrow = async () => runApi((api) => api.accountKeys.getMe());

/** The env-vault key wrapped to the caller's account key, to unwrap locally. */
export const getEnvVaultAccountWrap = async (accountKeyId: string) =>
  runApi((api) =>
    api.envVault.getWrap({ path: { recipientKind: "account", recipientId: accountKeyId } }),
  );

// Browser-side env-vault provisioning (web self-enrollment + admin grant). Register
// is bearer-self with no step-up, so a member can enroll their own account key from
// the vault origin; the escrow is sealed in the browser under a passphrase the user
// chooses (see @better-update/credentials-crypto `sealAccountKey`). The admin grant
// wraps the env-vault key to a member's account key — the admin must already hold the
// unlocked env-vault key (it is produced in the browser via `wrapVaultKey`).

/** Register the caller's OWN account key (bearer-self; no step-up). */
export const registerAccountKey = async (body: typeof RegisterAccountKeyBody.Type) =>
  runApi((api) => api.accountKeys.register({ payload: body }));

/** Wrap the env-vault key to a recipient (admin grant for another member's account key). */
export const addEnvWrap = async (body: typeof AddEnvVaultWrapBody.Type) =>
  runApi((api) => api.envVault.addWrap({ payload: body }));

export const accountKeysQueryKey = (orgId: string) => ["org", orgId, "account-keys"] as const;

/** The org's members' live account keys (public view) — for enrollment state + admin grant. */
export const accountKeysQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: accountKeysQueryKey(orgId),
    queryFn: async ({ signal }) => runApi((api) => api.accountKeys.list(), signal),
    staleTime: 30_000,
  });

export const envVaultWrapsQueryKey = (orgId: string) => ["org", orgId, "env-vault-wraps"] as const;

/** Recipients currently holding the env-vault key — to compute which account keys are pending. */
export const envVaultWrapsQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: envVaultWrapsQueryKey(orgId),
    queryFn: async ({ signal }) => runApi((api) => api.envVault.listWraps(), signal),
    staleTime: 30_000,
  });
