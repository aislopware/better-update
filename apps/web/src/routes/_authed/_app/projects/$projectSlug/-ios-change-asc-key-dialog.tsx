import {
  appleTeamsQueryOptions,
  ascApiKeysQueryOptions,
  iosBundleConfigurationsQueryOptions,
  updateIosBundleConfiguration,
} from "@better-update/api-client/react";
import { RadioGroup, RadioGroupItem } from "@better-update/ui/components/ui/radio-group";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Suspense } from "react";

import type { AscApiKeyItem } from "@better-update/api-client/react";

import { formatAppleTeamLabel } from "../../-credentials-utils";
import { useApiMutation } from "../../../../../lib/use-api-mutation";
import { ChangeCredentialDialog } from "./-change-credential-dialog";

interface ChooseSavedTabProps {
  readonly orgId: string;
  readonly appleTeamId: string;
  readonly currentId: string | null;
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
}

const ChooseSavedTab = ({
  orgId,
  appleTeamId,
  currentId,
  selectedId,
  onSelect,
}: ChooseSavedTabProps) => {
  const { data: keys } = useSuspenseQuery(ascApiKeysQueryOptions(orgId));
  const { data: teams } = useSuspenseQuery(appleTeamsQueryOptions(orgId));
  const teamMap = new Map(teams.items.map((team) => [team.id, team]));
  const filtered = keys.items.filter((key) => key.appleTeamId === appleTeamId);

  if (filtered.length === 0) {
    return (
      <p className="text-muted-foreground py-6 text-center text-sm">
        No saved ASC API keys for this Apple Team.
      </p>
    );
  }

  return (
    <RadioGroup
      value={selectedId}
      onValueChange={(value) => {
        onSelect(String(value));
      }}
    >
      <div className="flex flex-col gap-2">
        {filtered.map((key) => {
          const team = key.appleTeamId === null ? null : teamMap.get(key.appleTeamId);
          const isCurrent = key.id === currentId;
          return (
            <label
              key={key.id}
              htmlFor={`asc-${key.id}`}
              className="hover:bg-muted/50 has-data-[checked]:border-primary has-data-[checked]:bg-accent/30 flex cursor-pointer items-start gap-3 rounded-lg border p-3"
            >
              <RadioGroupItem id={`asc-${key.id}`} value={key.id} className="mt-1" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{key.name}</span>
                  {isCurrent ? (
                    <span className="text-muted-foreground text-xs">(current)</span>
                  ) : null}
                </div>
                <span className="text-muted-foreground font-mono text-xs">
                  {key.keyId}
                  {team ? ` · ${formatAppleTeamLabel(team)}` : ""}
                </span>
              </div>
            </label>
          );
        })}
      </div>
    </RadioGroup>
  );
};

interface IosChangeAscKeyDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
  readonly orgId: string;
  readonly projectId: string;
  readonly configIds: readonly string[];
  readonly appleTeamId: string;
  readonly currentKey: AscApiKeyItem | null;
}

export const IosChangeAscKeyDialog = ({
  open,
  onOpenChange,
  orgId,
  projectId,
  configIds,
  appleTeamId,
  currentKey,
}: IosChangeAscKeyDialogProps) => {
  const queryClient = useQueryClient();
  const initialSelectedId = currentKey === null ? "" : currentKey.id;
  const currentKeyId: string | null = currentKey === null ? null : currentKey.id;

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ascApiKeysQueryOptions(orgId).queryKey }),
      queryClient.invalidateQueries({
        queryKey: iosBundleConfigurationsQueryOptions(orgId, projectId).queryKey,
      }),
      queryClient.invalidateQueries({ queryKey: appleTeamsQueryOptions(orgId).queryKey }),
    ]);
  };

  const saveMutation = useApiMutation({
    mutationFn: async ({ selectedId }: { selectedId: string }) => {
      await Promise.all(
        configIds.map(async (id) => updateIosBundleConfiguration(id, { ascApiKeyId: selectedId })),
      );
    },
    onSuccess: async () => {
      await invalidate();
      onOpenChange(false);
    },
  });

  return (
    <ChangeCredentialDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Change App Store Connect API key"
      description="Pick a saved ASC API key for this Apple Team. The new binding applies to every distribution type for this bundle identifier."
      initialSelectedId={initialSelectedId}
      submitting={saveMutation.isPending}
      onSubmit={async (context) => saveMutation.mutateAsync(context)}
      renderSaved={({ selectedId, setSelectedId }) => (
        <Suspense fallback={<p className="text-muted-foreground text-sm">Loading saved keys…</p>}>
          <ChooseSavedTab
            orgId={orgId}
            appleTeamId={appleTeamId}
            currentId={currentKeyId}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </Suspense>
      )}
    />
  );
};
