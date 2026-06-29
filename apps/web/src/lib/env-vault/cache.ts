import { fromBase64, toBase64 } from "@better-update/encoding";

// In-session cache for the unlocked env-vault key. sessionStorage ONLY — it is
// cleared when the tab closes and is never written to disk (unlike localStorage),
// so the raw vault key never outlives the browsing session. Keyed per org. The
// independent vault.<host> origin isolates this storage from the main app origin.

interface CachedVault {
  readonly vaultKeyB64: string;
  readonly envVaultVersion: number;
}

export interface UnlockedEnvVault {
  readonly vaultKey: Uint8Array;
  readonly envVaultVersion: number;
}

const storageKey = (orgId: string) => `bu.env-vault.${orgId}`;

const isCachedVault = (value: unknown): value is CachedVault =>
  typeof value === "object" &&
  value !== null &&
  "vaultKeyB64" in value &&
  typeof value.vaultKeyB64 === "string" &&
  "envVaultVersion" in value &&
  typeof value.envVaultVersion === "number";

// These run only in the browser (the env-vault routes are client-only, ssr:false),
// so sessionStorage is always present — no SSR guard needed.

export const cacheEnvVaultKey = (orgId: string, vault: UnlockedEnvVault): void => {
  const payload: CachedVault = {
    vaultKeyB64: toBase64(vault.vaultKey),
    envVaultVersion: vault.envVaultVersion,
  };
  globalThis.sessionStorage.setItem(storageKey(orgId), JSON.stringify(payload));
};

export const readCachedEnvVaultKey = (orgId: string): UnlockedEnvVault | null => {
  const raw = globalThis.sessionStorage.getItem(storageKey(orgId));
  if (raw === null) {
    return null;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!isCachedVault(parsed)) {
    return null;
  }
  return { vaultKey: fromBase64(parsed.vaultKeyB64), envVaultVersion: parsed.envVaultVersion };
};

export const clearEnvVaultKey = (orgId: string): void => {
  globalThis.sessionStorage.removeItem(storageKey(orgId));
};
