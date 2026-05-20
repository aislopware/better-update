import {
  appleDistributionCertificatesQueryOptions,
  appleProvisioningProfilesQueryOptions,
  iosBundleConfigurationsQueryOptions,
  updateIosBundleConfiguration,
  uploadAppleProvisioningProfile,
} from "@better-update/api-client/react";
import { compact } from "@better-update/type-guards";
import { Field, FieldError, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@better-update/ui/components/ui/radio-group";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Suspense, useState } from "react";

import type {
  AppleProvisioningProfileItem,
  IosBundleConfigurationItem,
} from "@better-update/api-client/react";

import { safeReadFileAsBase64 } from "../../-credentials-utils";
import { formatDate } from "../../../../../lib/format-date";
import { useApiMutation } from "../../../../../lib/use-api-mutation";
import { ChangeCredentialDialog } from "./-change-credential-dialog";

import type { ChangeCredentialTab } from "./-change-credential-dialog";

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
        No saved provisioning profiles for this bundle identifier + distribution type. Switch to
        “Upload new” to add one.
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
                    : ` · expires ${formatDate(profile.validUntil)}`}
                </span>
              </div>
            </label>
          );
        })}
      </div>
    </RadioGroup>
  );
};

interface UploadFormState {
  readonly profileBase64: string;
  readonly appleDistributionCertificateId: string;
}

const UPLOAD_INITIAL: UploadFormState = {
  profileBase64: "",
  appleDistributionCertificateId: "",
};

const NONE_VALUE = "__none__";

const isUploadValid = (state: UploadFormState) => state.profileBase64.length > 0;

interface UploadTabProps {
  readonly orgId: string;
  readonly appleTeamId: string;
  readonly state: UploadFormState;
  readonly onChange: (next: UploadFormState) => void;
}

const UploadTab = ({ orgId, appleTeamId, state, onChange }: UploadTabProps) => {
  const { data: certs } = useSuspenseQuery(appleDistributionCertificatesQueryOptions(orgId));
  const teamCerts = certs.items.filter((cert) => cert.appleTeamId === appleTeamId);

  return (
    <div className="flex flex-col gap-3">
      <Field>
        <FieldLabel htmlFor="change-profile-file">.mobileprovision file</FieldLabel>
        <Input
          id="change-profile-file"
          type="file"
          accept=".mobileprovision"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (file === undefined) {
              return;
            }
            const value = await safeReadFileAsBase64(file);
            if (value === null) {
              toastManager.add({ title: "Failed to read file", type: "error" });
              return;
            }
            onChange({ ...state, profileBase64: value });
          }}
        />
        <FieldError match={state.profileBase64.length === 0}>
          .mobileprovision file required
        </FieldError>
      </Field>
      <Field>
        <FieldLabel htmlFor="change-profile-cert">Distribution certificate (optional)</FieldLabel>
        <Select
          value={
            state.appleDistributionCertificateId === ""
              ? NONE_VALUE
              : state.appleDistributionCertificateId
          }
          onValueChange={(value) => {
            const next = typeof value === "string" ? value : NONE_VALUE;
            onChange({
              ...state,
              appleDistributionCertificateId: next === NONE_VALUE ? "" : next,
            });
          }}
        >
          <SelectTrigger id="change-profile-cert">
            <SelectValue placeholder="Auto-detect from profile" />
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value={NONE_VALUE}>Auto-detect from profile</SelectItem>
            {teamCerts.map((cert) => (
              <SelectItem key={cert.id} value={cert.id}>
                {cert.serialNumber.slice(0, 16)}…
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </Field>
    </div>
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
  const [uploadState, setUploadState] = useState<UploadFormState>(UPLOAD_INITIAL);

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

  const resolveProfileId = async (
    tab: ChangeCredentialTab,
    selectedId: string,
  ): Promise<string> => {
    if (tab !== "upload") {
      return selectedId;
    }
    const payload = {
      profileBase64: uploadState.profileBase64,
      ...compact({
        appleDistributionCertificateId: uploadState.appleDistributionCertificateId || undefined,
      }),
    };
    const uploaded = await uploadAppleProvisioningProfile(payload);
    return uploaded.id;
  };

  const saveMutation = useApiMutation({
    mutationFn: async ({ tab, selectedId }: { tab: ChangeCredentialTab; selectedId: string }) => {
      const profileId = await resolveProfileId(tab, selectedId);
      await updateIosBundleConfiguration(bundleConfigId, {
        appleProvisioningProfileId: profileId,
      });
    },
    onSuccess: async () => {
      toastManager.add({ title: "Provisioning profile updated", type: "success" });
      await invalidate();
      onOpenChange(false);
    },
  });

  return (
    <ChangeCredentialDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Change provisioning profile"
      description="Upload a new .mobileprovision file or pick a saved profile matching this bundle identifier and distribution type."
      initialSelectedId={initialSelectedId}
      isUploadValid={isUploadValid(uploadState)}
      submitting={saveMutation.isPending}
      onSubmit={async (context) => saveMutation.mutateAsync(context)}
      onResetUpload={() => {
        setUploadState(UPLOAD_INITIAL);
      }}
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
      renderUpload={() => (
        <Suspense fallback={<p className="text-muted-foreground text-sm">Loading certificates…</p>}>
          <UploadTab
            orgId={orgId}
            appleTeamId={appleTeamId}
            state={uploadState}
            onChange={setUploadState}
          />
        </Suspense>
      )}
    />
  );
};
