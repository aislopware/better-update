import {
  appleDistributionCertificatesQueryOptions,
  appleTeamsQueryOptions,
  iosBundleConfigurationsQueryOptions,
  updateIosBundleConfiguration,
  uploadAppleDistributionCertificate,
} from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import { DatePicker } from "@better-update/ui/components/ui/date-picker";
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
import { Field, FieldError, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@better-update/ui/components/ui/radio-group";
import { Tabs, TabsList, TabsTab } from "@better-update/ui/components/ui/tabs";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Suspense, useState } from "react";

import type { AppleDistributionCertificateItem } from "@better-update/api-client/react";

import {
  dateToIsoBoundary,
  formatAppleTeamLabel,
  isoToDate,
  safeReadFileAsBase64,
} from "../../-credentials-utils";
import { formatDate } from "../../../../../lib/format-date";
import { safeSubmit, useApiMutation } from "../../../../../lib/use-api-mutation";

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
        No saved distribution certificates for this Apple Team. Switch to “Upload new” to add one.
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
                  {formatDate(cert.validUntil)}
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
  readonly p12Base64: string;
  readonly p12Password: string;
  readonly serialNumber: string;
  readonly appleTeamIdentifier: string;
  readonly validFrom: string;
  readonly validUntil: string;
}

const UPLOAD_INITIAL: UploadFormState = {
  p12Base64: "",
  p12Password: "",
  serialNumber: "",
  appleTeamIdentifier: "",
  validFrom: "",
  validUntil: "",
};

const isUploadValid = (state: UploadFormState) =>
  state.p12Base64.length > 0 &&
  state.p12Password.length > 0 &&
  state.serialNumber.length > 0 &&
  /^[A-Z0-9]{10}$/u.test(state.appleTeamIdentifier) &&
  state.validFrom.length > 0 &&
  state.validUntil.length > 0;

interface UploadTabProps {
  readonly state: UploadFormState;
  readonly onChange: (next: UploadFormState) => void;
}

const UploadTab = ({ state, onChange }: UploadTabProps) => (
  <div className="flex flex-col gap-3">
    <Field>
      <FieldLabel htmlFor="change-cert-file">.p12 file</FieldLabel>
      <Input
        id="change-cert-file"
        type="file"
        accept=".p12,application/x-pkcs12"
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
          onChange({ ...state, p12Base64: value });
        }}
      />
      <FieldError match={state.p12Base64.length === 0}>.p12 file required</FieldError>
    </Field>
    <Field>
      <FieldLabel htmlFor="change-cert-password">Archive password</FieldLabel>
      <Input
        id="change-cert-password"
        type="password"
        value={state.p12Password}
        onChange={(event) => {
          onChange({ ...state, p12Password: event.target.value });
        }}
      />
    </Field>
    <Field>
      <FieldLabel htmlFor="change-cert-team">Apple Team ID</FieldLabel>
      <Input
        id="change-cert-team"
        placeholder="ABCDE12345"
        value={state.appleTeamIdentifier}
        onChange={(event) => {
          onChange({ ...state, appleTeamIdentifier: event.target.value.toUpperCase() });
        }}
      />
      <FieldError
        match={
          state.appleTeamIdentifier.length > 0 && !/^[A-Z0-9]{10}$/u.test(state.appleTeamIdentifier)
        }
      >
        10 uppercase alphanumeric
      </FieldError>
    </Field>
    <Field>
      <FieldLabel htmlFor="change-cert-serial">Serial number</FieldLabel>
      <Input
        id="change-cert-serial"
        value={state.serialNumber}
        onChange={(event) => {
          onChange({ ...state, serialNumber: event.target.value });
        }}
      />
    </Field>
    <div className="grid grid-cols-2 gap-3">
      <Field>
        <FieldLabel>Valid from</FieldLabel>
        <DatePicker
          value={isoToDate(state.validFrom)}
          onChange={(value) => {
            onChange({ ...state, validFrom: dateToIsoBoundary(value, "start") });
          }}
        />
      </Field>
      <Field>
        <FieldLabel>Valid until</FieldLabel>
        <DatePicker
          value={isoToDate(state.validUntil)}
          onChange={(value) => {
            onChange({ ...state, validUntil: dateToIsoBoundary(value, "end") });
          }}
        />
      </Field>
    </div>
  </div>
);

interface IosChangeCertDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
  readonly orgId: string;
  readonly projectId: string;
  readonly bundleConfigId: string;
  readonly appleTeamId: string;
  readonly currentCert: AppleDistributionCertificateItem | null;
}

type TabValue = "saved" | "upload";

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
  const [tab, setTab] = useState<TabValue>("saved");
  const [selectedId, setSelectedId] = useState<string>(initialSelectedId);
  const [uploadState, setUploadState] = useState<UploadFormState>(UPLOAD_INITIAL);

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

  const resolveCertId = async (): Promise<string> => {
    if (tab !== "upload") {
      return selectedId;
    }
    const uploaded = await uploadAppleDistributionCertificate({
      p12Base64: uploadState.p12Base64,
      p12Password: uploadState.p12Password,
      serialNumber: uploadState.serialNumber,
      appleTeamIdentifier: uploadState.appleTeamIdentifier,
      validFrom: uploadState.validFrom,
      validUntil: uploadState.validUntil,
    });
    return uploaded.id;
  };

  const saveMutation = useApiMutation({
    mutationFn: async () => {
      const certId = await resolveCertId();
      await updateIosBundleConfiguration(bundleConfigId, {
        appleDistributionCertificateId: certId,
      });
    },
    onSuccess: async () => {
      toastManager.add({ title: "Distribution certificate updated", type: "success" });
      await invalidate();
      onOpenChange(false);
    },
  });

  const canSubmit = tab === "upload" ? isUploadValid(uploadState) : selectedId.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(next) => {
        if (!next) {
          setTab("saved");
          setSelectedId(initialSelectedId);
          setUploadState(UPLOAD_INITIAL);
        }
      }}
    >
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Change distribution certificate</DialogTitle>
          <DialogDescription>
            Upload a new .p12 certificate or pick one already saved on this Apple Team.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Tabs
            value={tab}
            onValueChange={(value) => {
              setTab(value === "upload" ? "upload" : "saved");
            }}
            className="mb-4"
          >
            <TabsList>
              <TabsTab value="saved">Choose saved</TabsTab>
              <TabsTab value="upload">Upload new</TabsTab>
            </TabsList>
          </Tabs>
          {tab === "saved" ? (
            <Suspense
              fallback={
                <p className="text-muted-foreground text-sm">Loading saved certificates…</p>
              }
            >
              <ChooseSavedTab
                orgId={orgId}
                appleTeamId={appleTeamId}
                currentId={currentCertId}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            </Suspense>
          ) : (
            <UploadTab state={uploadState} onChange={setUploadState} />
          )}
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            disabled={!canSubmit}
            loading={saveMutation.isPending}
            onClick={async () => {
              await safeSubmit(saveMutation.mutateAsync(undefined));
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
