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
import { Loader } from "@better-update/ui/components/loader";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@better-update/ui/components/ui/input-group";

import type { EnvVar } from "@better-update/api";

import { CopyButton } from "../../../../lib/copy-button";
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
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader size="sm" /> Decrypting…
      </div>
    );
  }
  if (guarded.kind === "error") {
    return <p className="text-destructive text-sm">{guarded.message}</p>;
  }
  return (
    <InputGroup>
      <InputGroupInput readOnly value={guarded.value} className="font-mono text-sm" />
      <InputGroupAddon align="inline-end">
        <CopyButton value={guarded.value} label={envVar.key} size="xs" />
      </InputGroupAddon>
    </InputGroup>
  );
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
          Value of <span className="font-mono">{envVar.key}</span>
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
