import { getApiError } from "@better-update/api-client";
import { getEnvVarValue } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { FingerprintIcon } from "lucide-react";
import { useState } from "react";

import type { EnvVar } from "@better-update/api";

import { revealEnvValue } from "../../../../lib/env-vault/reveal";
import {
  isStepUpFresh,
  isStepUpRequiredError,
  runPasskeyStepUp,
} from "../../../../lib/env-vault/step-up";
import { useApiMutation } from "../../../../lib/use-api-mutation";

import type { UnlockedEnvVault } from "../../../../lib/env-vault/use-env-vault";

/**
 * Reveal/edit of an env value reads the sealed envelope, which the server gates on
 * a fresh WebAuthn step-up (~10 min TTL). The unlocked vault key outlives that
 * window, so a dialog can open "unlocked" yet the read 403s. This guard reconciles
 * the two: it only fetches once a step-up looks fresh, and turns the server's
 * step-up rejection into an inline "verify your passkey" prompt instead of a
 * dead-end error — keeping the WebAuthn ceremony inside a real click (Safari
 * requires user activation), then refetching on success.
 */
export type GuardedEnvValue =
  | { readonly kind: "needs-step-up"; readonly verify: () => void; readonly verifying: boolean }
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly value: string };

export const useGuardedEnvValue = ({
  envVar,
  orgId,
  vault,
}: {
  envVar: EnvVar;
  orgId: string;
  vault: UnlockedEnvVault;
}): GuardedEnvValue => {
  // Flips true after an in-dialog step-up so the gated read stays enabled even if
  // the cached freshness window is borderline. (Re-gating after a value has loaded
  // is driven by the server's 403, not this flag — see the gate condition below.)
  const [verified, setVerified] = useState(false);

  const valueQuery = useQuery({
    queryKey: ["env-var-value", envVar.id],
    queryFn: async () => getEnvVarValue(envVar.id),
    // Don't fire the gated read until we believe a step-up will be accepted.
    enabled: verified || isStepUpFresh(),
    // Don't retain the sealed envelope in the cache beyond the open dialog, and
    // don't retry a 403 — surface the step-up gate immediately.
    staleTime: 0,
    gcTime: 0,
    retry: false,
    // This is a one-shot read to seed the dialog; never auto-refetch it. An
    // involuntary background refetch (window focus / reconnect) after the step-up
    // lapses would 403 in place — replacing a shown value (or unmounting the edit
    // form mid-typing) — so the only refetch is the explicit one after re-verify.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const stepUpMutation = useApiMutation({
    mutationFn: runPasskeyStepUp,
    onSuccess: async () => {
      setVerified(true);
      await valueQuery.refetch();
    },
  });

  // Gate on either (a) the server authoritatively rejecting the read for a stale
  // step-up — always, even after an in-dialog verify, so the re-prompt the error
  // copy promises is actually available and never dead-ends; or (b) before any
  // successful read, the client window having lapsed. Once a value has loaded,
  // a lapsing *client* window must NOT hide it (only the server's 403 re-gates) —
  // otherwise an already-revealed value vanishes / the edit form unmounts and loses
  // the user's in-progress text.
  const serverRejectedStepUp = valueQuery.isError && isStepUpRequiredError(valueQuery.error);
  if (serverRejectedStepUp || (!verified && !valueQuery.isSuccess && !isStepUpFresh())) {
    return {
      kind: "needs-step-up",
      verify: () => {
        stepUpMutation.mutate();
      },
      verifying: stepUpMutation.isPending,
    };
  }
  if (valueQuery.isPending || valueQuery.isFetching) {
    return { kind: "loading" };
  }
  if (valueQuery.isError) {
    return { kind: "error", message: getApiError(valueQuery.error) };
  }
  const revealed = revealEnvValue({
    vault,
    orgId,
    envelope: valueQuery.data,
    expectKey: envVar.key,
    expectEnvironment: envVar.environment,
  });
  return revealed.ok
    ? { kind: "ready", value: revealed.value }
    : { kind: "error", message: revealed.error };
};

/**
 * Inline prompt shown when a step-up has lapsed: a short explanation plus a button
 * that runs the WebAuthn ceremony from a click. `action` names what the user is
 * trying to do (e.g. "reveal", "edit").
 */
export const StepUpGate = ({
  action,
  verifying,
  onVerify,
}: {
  action: string;
  verifying: boolean;
  onVerify: () => void;
}) => (
  <div className="flex flex-col items-start gap-3 text-sm">
    <p className="text-muted-foreground">
      Your passkey check has expired. Verify again to {action} this value.
    </p>
    <Button type="button" loading={verifying} onClick={onVerify}>
      <FingerprintIcon strokeWidth={2} data-icon="inline-start" />
      Verify with passkey
    </Button>
  </div>
);
