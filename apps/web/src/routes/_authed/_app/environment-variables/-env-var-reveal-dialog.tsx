import { getApiError } from "@better-update/api-client";
import { getEnvVarValue } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@better-update/ui/components/ui/input-group";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { EnvVar } from "@better-update/api";

import { CopyButton } from "../../../../lib/copy-button";
import { revealEnvValue } from "../../../../lib/env-vault/reveal";

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
  // Don't retain the sealed envelope in the query cache beyond the open dialog.
  const valueQuery = useQuery({
    queryKey: ["env-var-value", envVar.id],
    queryFn: async () => getEnvVarValue(envVar.id),
    staleTime: 0,
    gcTime: 0,
  });

  const revealed = useMemo(
    () =>
      valueQuery.data
        ? revealEnvValue({
            vault,
            orgId,
            envelope: valueQuery.data,
            expectKey: envVar.key,
            expectEnvironment: envVar.environment,
          })
        : null,
    [valueQuery.data, vault, orgId, envVar.key, envVar.environment],
  );

  if (valueQuery.isPending) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Spinner /> Decrypting…
      </div>
    );
  }
  if (valueQuery.isError) {
    // Surface the server message — notably a step-up-expired 403 reads "Verify
    // your passkey and retry" so the user knows to Re-verify rather than retry.
    return <p className="text-destructive text-sm">{getApiError(valueQuery.error)}</p>;
  }
  if (revealed === null) {
    return <p className="text-destructive text-sm">Could not load this value. Please try again.</p>;
  }
  if (!revealed.ok) {
    return <p className="text-destructive text-sm">{revealed.error}</p>;
  }
  return (
    <InputGroup>
      <InputGroupInput readOnly value={revealed.value} className="font-mono text-sm" />
      <InputGroupAddon align="inline-end">
        <CopyButton value={revealed.value} label={envVar.key} size="icon-xs" />
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
    <DialogPopup>
      <DialogHeader>
        <DialogTitle>
          Value of <span className="font-mono">{envVar.key}</span>
        </DialogTitle>
        <DialogDescription>
          Decrypted in your browser. It is never sent to the server in plaintext.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        {open ? <RevealBody envVar={envVar} orgId={orgId} vault={vault} /> : null}
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Close</DialogClose>
      </DialogFooter>
    </DialogPopup>
  </Dialog>
);
