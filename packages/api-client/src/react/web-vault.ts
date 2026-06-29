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
