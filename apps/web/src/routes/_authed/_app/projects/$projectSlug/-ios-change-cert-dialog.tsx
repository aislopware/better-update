import {
  appleDistributionCertificatesQueryOptions,
  appleTeamsQueryOptions,
  iosBundleConfigurationsQueryOptions,
  updateIosBundleConfiguration,
} from "@better-update/api-client/react";
import { RadioGroup, RadioGroupItem } from "@better-update/ui/components/ui/radio-group";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Suspense } from "react";

import type { AppleDistributionCertificateItem } from "@better-update/api-client/react";

import { formatAppleTeamLabel } from "../../-credentials-utils";
import { deriveExpiryStatus } from "../../../../../lib/credential-status";
import { formatDate } from "../../../../../lib/format-date";
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
  const { data: certs } = useSuspenseQuery(appleDistributionCertificatesQueryOptions(orgId));
  const { data: teams } = useSuspenseQuery(appleTeamsQueryOptions(orgId));
  const teamMap = new Map(teams.items.map((team) => [team.id, team]));
  const filtered = certs.items.filter((cert) => cert.appleTeamId === appleTeamId);

  if (filtered.length === 0) {
    return (
      <p className="text-muted-foreground py-6 text-center text-sm">
        No saved distribution certificates for this Apple Team.
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
        {filtered.map((cert) => {
          const team = teamMap.get(cert.appleTeamId);
          const isCurrent = cert.id === currentId;
          const status = deriveExpiryStatus(cert.validUntil);
          return (
            <label
              key={cert.id}
              htmlFor={`cert-${cert.id}`}
              className="hover:bg-muted/50 has-data-[checked]:border-primary has-data-[checked]:bg-accent/30 flex cursor-pointer items-start gap-3 rounded-lg border p-3"
            >
              <RadioGroupItem id={`cert-${cert.id}`} value={cert.id} className="mt-1" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs">{cert.serialNumber.slice(0, 16)}…</span>
                  {isCurrent ? (
                    <span className="text-muted-foreground text-xs">(current)</span>
                  ) : null}
                </div>
                <span className="text-muted-foreground text-xs">
                  {team ? formatAppleTeamLabel(team) : cert.appleTeamId} · expires{" "}
                  {formatDate(cert.validUntil)} · {status.label}
                </span>
              </div>
            </label>
          );
        })}
      </div>
    </RadioGroup>
  );
};

interface IosChangeCertDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
  readonly orgId: string;
  readonly projectId: string;
  readonly bundleConfigId: string;
  readonly appleTeamId: string;
  readonly currentCert: AppleDistributionCertificateItem | null;
}

export const IosChangeCertDialog = ({
  open,
  onOpenChange,
  orgId,
  projectId,
  bundleConfigId,
  appleTeamId,
  currentCert,
}: IosChangeCertDialogProps) => {
  const queryClient = useQueryClient();
  const initialSelectedId = currentCert === null ? "" : currentCert.id;
  const currentCertId: string | null = currentCert === null ? null : currentCert.id;

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: appleDistributionCertificatesQueryOptions(orgId).queryKey,
      }),
      queryClient.invalidateQueries({
        queryKey: iosBundleConfigurationsQueryOptions(orgId, projectId).queryKey,
      }),
      queryClient.invalidateQueries({
        queryKey: appleTeamsQueryOptions(orgId).queryKey,
      }),
    ]);
  };

  const saveMutation = useApiMutation({
    mutationFn: async ({ selectedId }: { selectedId: string }) => {
      await updateIosBundleConfiguration(bundleConfigId, {
        appleDistributionCertificateId: selectedId,
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
      title="Change distribution certificate"
      description="Pick a saved distribution certificate for this Apple Team."
      initialSelectedId={initialSelectedId}
      submitting={saveMutation.isPending}
      onSubmit={async (context) => saveMutation.mutateAsync(context)}
      renderSaved={({ selectedId, setSelectedId }) => (
        <Suspense
          fallback={<p className="text-muted-foreground text-sm">Loading saved certificates…</p>}
        >
          <ChooseSavedTab
            orgId={orgId}
            appleTeamId={appleTeamId}
            currentId={currentCertId}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </Suspense>
      )}
    />
  );
};
