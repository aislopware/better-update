import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { FingerprintIcon } from "lucide-react";
import { useState } from "react";

import { SettingCard } from "../../../../components/setting-card";
import { ListItemsSkeleton, SettingCardSkeleton } from "../../../../components/skeletons";
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
    <SettingCard
      title="Passkeys"
      description="Verify with biometrics or a security key to unlock the environment-variable vault."
      action={<AddPasskeyDialog invalidate={invalidate} />}
    >
      {passkeys.length === 0 ? (
        <p className="text-muted-foreground py-2 text-sm">
          No passkeys added yet. Add one to unlock the env-vault from your browser.
        </p>
      ) : (
        <ul className="-my-3 flex flex-col divide-y">
          {passkeys.map((passkey) => (
            <li key={passkey.id} className="flex items-center gap-3 py-3">
              <span className="bg-muted/72 flex size-9 shrink-0 items-center justify-center rounded-md border">
                <FingerprintIcon strokeWidth={2} className="size-4" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm leading-none font-medium">
                    {passkey.name ?? "Unnamed passkey"}
                  </span>
                  {passkey.backedUp ? <Badge variant="success">Synced</Badge> : null}
                </div>
                <span className="text-muted-foreground truncate text-xs">
                  Added <RelativeTime value={passkey.createdAt} />
                </span>
              </div>
              <Button
                variant="outline"
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
            </li>
          ))}
        </ul>
      )}
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
    </SettingCard>
  );
};

const PasskeysPagePending = () => (
  <SettingCardSkeleton hasFooter={false}>
    <ListItemsSkeleton rows={2} />
  </SettingCardSkeleton>
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
