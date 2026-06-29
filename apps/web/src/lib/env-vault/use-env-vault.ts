import { useCallback, useState } from "react";

import { clearEnvVaultKey } from "./cache";
import { isVaultHost } from "./host";
import { clearStepUp } from "./step-up";
import { getUnlockedEnvVault } from "./unlock";

import type { UnlockedEnvVault } from "./cache";

export type { UnlockedEnvVault } from "./cache";

export interface EnvVaultController {
  /** Whether env-vault mutations are exposed on this origin (host-gated). */
  readonly enabled: boolean;
  /** The unlocked vault key for this org, or `null` if still locked this session. */
  readonly unlocked: UnlockedEnvVault | null;
  /** Adopt a freshly unlocked vault (called by the unlock dialog on success). */
  readonly onUnlocked: (vault: UnlockedEnvVault) => void;
  /** Forget the unlocked key (clears the sessionStorage cache). */
  readonly lock: () => void;
}

interface Tracked {
  readonly orgId: string;
  readonly unlocked: UnlockedEnvVault | null;
}

/**
 * React state around the per-session env-vault unlock for one org. The unlocked
 * key itself lives in sessionStorage (see ./cache); this hook mirrors it into
 * React state so the toolbar and row actions re-render when the vault is unlocked
 * or locked. `enabled` host-gates the entire mutation surface to the dedicated
 * vault origin — on the main dashboard origin it is always `false`, so the
 * env-vars view stays exactly as read-only as it is today.
 */
export const useEnvVault = (orgId: string): EnvVaultController => {
  const enabled = isVaultHost();
  const [tracked, setTracked] = useState<Tracked>(() => ({
    orgId,
    unlocked: enabled ? getUnlockedEnvVault(orgId) : null,
  }));

  // Re-read the cache when the active org changes, without a (restricted) effect
  // — the React "adjust state during render" pattern; it re-renders immediately
  // and then `tracked.orgId === orgId`, so it does not loop.
  if (tracked.orgId !== orgId) {
    setTracked({ orgId, unlocked: enabled ? getUnlockedEnvVault(orgId) : null });
  }

  const onUnlocked = useCallback(
    (vault: UnlockedEnvVault) => {
      setTracked({ orgId, unlocked: vault });
    },
    [orgId],
  );

  const lock = useCallback(() => {
    clearEnvVaultKey(orgId);
    // The step-up is session-scoped (not per-org); locking the vault is the user
    // signalling "done", so drop the freshness window too — the next unlock re-proves it.
    clearStepUp();
    setTracked({ orgId, unlocked: null });
  }, [orgId]);

  return { enabled, unlocked: tracked.unlocked, onUnlocked, lock };
};
