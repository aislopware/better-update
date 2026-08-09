import { Button } from "@better-update/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@better-update/ui/components/dialog";
import { InlineCode } from "@better-update/ui/components/inline-code";
import { Loader } from "@better-update/ui/components/loader";
import { SensitiveInput } from "@better-update/ui/components/sensitive-input";

import type { EnvVar } from "@better-update/api";

import { StepUpGate, useGuardedEnvValue } from "./-step-up-guard";

import type { UnlockedEnvVault } from "../../../../lib/env-vault/use-env-vault";

const RevealBody = ({
  envVar,
  orgId,
  vault,
}: {
  envVar: EnvVar;
  orgId: string;
  vault: UnlockedEnvVault;
}) => {
  const guarded = useGuardedEnvValue({ envVar, orgId, vault });

  if (guarded.kind === "needs-step-up") {
    return (
      <StepUpGate
        action="reveal"
        verifying={guarded.verifying}
        onVerify={() => {
          guarded.verify();
        }}
      />
    );
  }
  if (guarded.kind === "loading") {
    return (
      <div className="text-kumo-subtle flex items-center gap-2 text-sm">
        <Loader size="sm" /> Decrypting…
      </div>
    );
  }
  if (guarded.kind === "error") {
    return <p className="text-kumo-danger text-sm">{guarded.message}</p>;
  }
  // Kumo's own control for a secret, in place of a read-only field with a copy
  // button bolted to its end: it comes up masked and reveals on a click or on
  // Enter, hides again when focus leaves, carries its own copy button, and says
  // all of that to a screen reader. The step-up gates fetching the envelope; a
  // decrypted value left sitting on screen is a different exposure — a shared
  // screen, someone walking past — and this is the one that answers it.
  return <SensitiveInput readOnly value={guarded.value} className="font-mono text-sm" />;
};

/**
 * Reveal one env-var value: fetch the sealed envelope (server gates this on a
 * fresh passkey step-up), decrypt it locally with the unlocked vault key, and
 * cross-check the sealed key/environment against the row before showing it.
 * Controlled by the row's action menu.
 */
export const EnvVarRevealDialog = ({
  envVar,
  orgId,
  vault,
  open,
  onOpenChange,
}: {
  envVar: EnvVar;
  orgId: string;
  vault: UnlockedEnvVault;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent size="lg">
      <DialogHeader>
        <DialogTitle>
          Value of <InlineCode>{envVar.key}</InlineCode>
        </DialogTitle>
        <DialogDescription>
          Decrypted in your browser. It is never sent to the server in plaintext.
        </DialogDescription>
      </DialogHeader>
      {open ? <RevealBody envVar={envVar} orgId={orgId} vault={vault} /> : null}
      <DialogFooter>
        <DialogClose render={<Button variant="secondary" />}>Close</DialogClose>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
