import {
  appleProvisioningProfilesQueryOptions,
  iosBundleConfigurationsQueryOptions,
  updateIosBundleConfiguration,
} from "@better-update/api-client/react";
import { RadioGroup, RadioGroupItem } from "@better-update/ui/components/ui/radio-group";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Suspense } from "react";

import type {
  AppleProvisioningProfileItem,
  IosBundleConfigurationItem,
} from "@better-update/api-client/react";

import { deriveExpiryStatus } from "../../../../../lib/credential-status";
import { formatDate } from "../../../../../lib/format-date";
import { useApiMutation } from "../../../../../lib/use-api-mutation";
import { ChangeCredentialDialog } from "./-change-credential-dialog";

interface ChooseSavedTabProps {
  readonly orgId: string;
  readonly bundleIdentifier: string;
  readonly distributionType: IosBundleConfigurationItem["distributionType"];
  readonly appleTeamId: string;
  readonly currentId: string | null;
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
}

const ChooseSavedTab = ({
  orgId,
  bundleIdentifier,
  distributionType,
  appleTeamId,
  currentId,
  selectedId,
  onSelect,
}: ChooseSavedTabProps) => {
  const { data: profiles } = useSuspenseQuery(
    appleProvisioningProfilesQueryOptions(orgId, {
      bundleIdentifier,
      distributionType,
      appleTeamId,
    }),
  );

  if (profiles.items.length === 0) {
    return (
      <p className="text-muted-foreground py-6 text-center text-sm">
        No saved provisioning profiles for this bundle identifier + distribution type.
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
        {profiles.items.map((profile) => {
          const isCurrent = profile.id === currentId;
          const status = deriveExpiryStatus(profile.validUntil);
          return (
            <label
              key={profile.id}
              htmlFor={`profile-${profile.id}`}
              className="hover:bg-muted/50 has-data-[checked]:border-primary has-data-[checked]:bg-accent/30 flex cursor-pointer items-start gap-3 rounded-lg border p-3"
            >
              <RadioGroupItem id={`profile-${profile.id}`} value={profile.id} className="mt-1" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {profile.profileName ?? profile.developerPortalIdentifier ?? "Unnamed profile"}
                  </span>
                  {isCurrent ? (
                    <span className="text-muted-foreground text-xs">(current)</span>
                  ) : null}
                </div>
                <span className="text-muted-foreground text-xs">
                  {profile.developerPortalIdentifier ?? profile.id.slice(0, 8)}
                  {profile.validUntil === null
                    ? ""
                    : ` · expires ${formatDate(profile.validUntil)} · `}
                  {profile.validUntil === null ? "" : status.label}
                </span>
              </div>
            </label>
          );
        })}
      </div>
    </RadioGroup>
  );
};

interface IosChangeProfileDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
  readonly orgId: string;
  readonly projectId: string;
  readonly bundleConfigId: string;
  readonly bundleIdentifier: string;
  readonly distributionType: IosBundleConfigurationItem["distributionType"];
  readonly appleTeamId: string;
  readonly currentProfile: AppleProvisioningProfileItem | null;
}

export const IosChangeProfileDialog = ({
  open,
  onOpenChange,
  orgId,
  projectId,
  bundleConfigId,
  bundleIdentifier,
  distributionType,
  appleTeamId,
  currentProfile,
}: IosChangeProfileDialogProps) => {
  const queryClient = useQueryClient();
  const initialSelectedId = currentProfile === null ? "" : currentProfile.id;
  const currentProfileId: string | null = currentProfile === null ? null : currentProfile.id;

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: appleProvisioningProfilesQueryOptions(orgId).queryKey,
      }),
      queryClient.invalidateQueries({
        queryKey: iosBundleConfigurationsQueryOptions(orgId, projectId).queryKey,
      }),
    ]);
  };

  const saveMutation = useApiMutation({
    mutationFn: async ({ selectedId }: { selectedId: string }) => {
      await updateIosBundleConfiguration(bundleConfigId, {
        appleProvisioningProfileId: selectedId,
      });
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
      title="Change provisioning profile"
      description="Pick a saved profile matching this bundle identifier and distribution type."
      initialSelectedId={initialSelectedId}
      submitting={saveMutation.isPending}
      onSubmit={async (context) => saveMutation.mutateAsync(context)}
      renderSaved={({ selectedId, setSelectedId }) => (
        <Suspense
          fallback={<p className="text-muted-foreground text-sm">Loading saved profiles…</p>}
        >
          <ChooseSavedTab
            orgId={orgId}
            bundleIdentifier={bundleIdentifier}
            distributionType={distributionType}
            appleTeamId={appleTeamId}
            currentId={currentProfileId}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </Suspense>
      )}
    />
  );
};
