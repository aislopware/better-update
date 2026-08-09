import { Badge } from "@better-update/ui/components/badge";
import { Button } from "@better-update/ui/components/button";
import { FingerprintIcon } from "@phosphor-icons/react";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { PageHeader } from "../../../../components/page-header";
import { TableSkeleton } from "../../../../components/skeletons";
import { ListPanel, ListPanelFooter, ListPanelRow } from "../../../../lib/data-table";
import { RelativeTime } from "../../../../lib/relative-time";
import { passkeysQueryOptions } from "../../../../queries/auth";
import { AddPasskeyDialog, DeletePasskeyDialog, RenamePasskeyDialog } from "./-passkey-dialogs";

import type { UserPasskey } from "../../../../queries/auth";

type ActiveDialog = { mode: "rename" | "delete"; passkey: UserPasskey } | null;

const PasskeysList = () => {
  const queryClient = useQueryClient();
  const { data: passkeys } = useSuspenseQuery(passkeysQueryOptions);
  const [active, setActive] = useState<ActiveDialog>(null);

  // invalidate (not reset) so the list refetches in the background without
  // re-suspending the card to its skeleton on every add/rename/remove.
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: passkeysQueryOptions.queryKey });
  };

  return (
    <>
      <PageHeader
        title="Passkeys"
        description="Verify with biometrics or a security key to unlock the environment-variable vault."
        actions={<AddPasskeyDialog invalidate={invalidate} />}
      />
      {/* The page names the list, so the panel around it does not say it again;
          the rows share one frame the way every other list here does. */}
      <ListPanel>
        {passkeys.length === 0 ? (
          <ListPanelFooter>
            <span className="text-kumo-subtle text-sm">
              No passkeys added yet. Add one to unlock the env-vault from your browser.
            </span>
          </ListPanelFooter>
        ) : (
          passkeys.map((passkey) => (
            <ListPanelRow
              key={passkey.id}
              media={<FingerprintIcon weight="bold" />}
              title={
                <>
                  <span className="truncate">{passkey.name ?? "Unnamed passkey"}</span>
                  {passkey.backedUp ? <Badge variant="success">Synced</Badge> : null}
                </>
              }
              description={
                <>
                  Added <RelativeTime value={passkey.createdAt} />
                </>
              }
              actions={
                <>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setActive({ mode: "rename", passkey });
                    }}
                  >
                    Rename
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setActive({ mode: "delete", passkey });
                    }}
                  >
                    Remove
                  </Button>
                </>
              }
            />
          ))
        )}
      </ListPanel>
      {active?.mode === "rename" ? (
        <RenamePasskeyDialog
          passkey={active.passkey}
          invalidate={invalidate}
          open
          onOpenChange={(next) => {
            if (!next) {
              setActive(null);
            }
          }}
        />
      ) : null}
      {active?.mode === "delete" ? (
        <DeletePasskeyDialog
          passkey={active.passkey}
          invalidate={invalidate}
          open
          onOpenChange={(next) => {
            if (!next) {
              setActive(null);
            }
          }}
        />
      ) : null}
    </>
  );
};

const PasskeysPagePending = () => (
  <>
    <PageHeader
      title="Passkeys"
      description="Verify with biometrics or a security key to unlock the environment-variable vault."
    />
    <TableSkeleton columns={2} rows={2} hasFooter={false} />
  </>
);

export const Route = createFileRoute("/_authed/_app/account/passkeys")({
  beforeLoad: async ({ context }) => {
    await context.queryClient.ensureQueryData(passkeysQueryOptions);
  },
  pendingComponent: PasskeysPagePending,
  pendingMs: 0,
  pendingMinMs: 0,
  component: PasskeysList,
});
