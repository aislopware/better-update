import {
  appleDistributionCertificatesQueryOptions,
  appleProvisioningProfilesQueryOptions,
  appleTeamsQueryOptions,
  ascApiKeysQueryOptions,
  createIosBundleConfiguration,
  devicesQueryOptions,
  generateAppleProvisioningProfile,
  iosBundleConfigurationsQueryOptions,
} from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogPopup,
  DialogPanel,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import {
  Select,
  SelectPopup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { WandIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { formatAppleTeamLabel } from "../../-credentials-utils";
import { safeSubmit, useApiMutation } from "../../../../../lib/use-api-mutation";
import { BUNDLE_PATTERN } from "./-ios-wizard-state";
import { StepperHeader } from "./-wizard-ui";

const STEPS = [
  { label: "Certificate" },
  { label: "Devices" },
  { label: "Profile" },
  { label: "Save" },
] as const;

interface WizardState {
  readonly certId: string;
  readonly ascKeyId: string;
  readonly deviceIds: readonly string[];
  readonly profileId: string | null;
  readonly bundleIdentifier: string;
}

const INITIAL: WizardState = {
  certId: "",
  ascKeyId: "",
  deviceIds: [],
  profileId: null,
  bundleIdentifier: "",
};

const StepCertificate = ({
  orgId,
  state,
  onChange,
}: {
  orgId: string;
  state: WizardState;
  onChange: (next: WizardState) => void;
}) => {
  const { data: certs } = useSuspenseQuery(appleDistributionCertificatesQueryOptions(orgId));
  const { data: teams } = useSuspenseQuery(appleTeamsQueryOptions(orgId));
  const teamById = useMemo(
    () => new Map(teams.items.map((team) => [team.id, team])),
    [teams.items],
  );
  if (certs.items.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No distribution certificates available. Upload one from the Credentials page before running
        this wizard.
      </p>
    );
  }
  const certLabel = (cert: (typeof certs.items)[number]): string => {
    const team = teamById.get(cert.appleTeamId);
    if (team === undefined) {
      return cert.serialNumber;
    }
    return `${cert.serialNumber.slice(0, 12)}... · ${formatAppleTeamLabel(team)}`;
  };
  const certLabels: Record<string, string> = Object.fromEntries(
    certs.items.map((cert) => [cert.id, certLabel(cert)]),
  );
  return (
    <Field>
      <FieldLabel htmlFor="wiz-cert">Distribution Certificate</FieldLabel>
      <Select
        items={certLabels}
        value={state.certId}
        onValueChange={(value) => {
          onChange({
            ...state,
            certId: typeof value === "string" ? value : "",
            deviceIds: [],
            ascKeyId: "",
            profileId: null,
          });
        }}
      >
        <SelectTrigger id="wiz-cert">
          <SelectValue placeholder="Select a certificate" />
        </SelectTrigger>
        <SelectPopup>
          {certs.items.map((cert) => (
            <SelectItem key={cert.id} value={cert.id}>
              {certLabel(cert)}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </Field>
  );
};

const StepDevices = ({
  orgId,
  state,
  onChange,
}: {
  orgId: string;
  state: WizardState;
  onChange: (next: WizardState) => void;
}) => {
  const { data: certs } = useSuspenseQuery(appleDistributionCertificatesQueryOptions(orgId));
  const cert = certs.items.find((item) => item.id === state.certId);
  const teamId = cert?.appleTeamId;
  const { data: devices } = useSuspenseQuery(
    devicesQueryOptions(orgId, {
      limit: 100,
      ...(teamId === undefined ? {} : { appleTeamId: teamId }),
    }),
  );
  const deviceItems = devices.items;
  if (deviceItems.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No devices registered under this Apple Team. Register devices on the Apple Devices page
        first.
      </p>
    );
  }
  const selected = new Set(state.deviceIds);
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onChange({ ...state, deviceIds: [...next] });
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-xs">
        {selected.size} / {deviceItems.length} selected
      </p>
      <div className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-md border p-2">
        {deviceItems.map((device) => {
          const isSelected = selected.has(device.id);
          return (
            <button
              key={device.id}
              type="button"
              onClick={() => {
                toggle(device.id);
              }}
              className="hover:bg-muted flex items-center justify-between rounded-sm px-2 py-1 text-left text-sm"
              aria-pressed={isSelected}
            >
              <span className="flex flex-col">
                <span>{device.name}</span>
                <span className="text-muted-foreground font-mono text-xs">{device.identifier}</span>
              </span>
              <span
                className={`size-4 rounded border ${
                  isSelected ? "border-primary bg-primary" : "border-border"
                }`}
                aria-hidden
              />
            </button>
          );
        })}
      </div>
    </div>
  );
};

const StepProfile = ({
  orgId,
  state,
  onChange,
  onGenerate,
  isGenerating,
}: {
  orgId: string;
  state: WizardState;
  onChange: (next: WizardState) => void;
  onGenerate: () => void;
  isGenerating: boolean;
}) => {
  const { data: keys } = useSuspenseQuery(ascApiKeysQueryOptions(orgId));
  const { data: certs } = useSuspenseQuery(appleDistributionCertificatesQueryOptions(orgId));
  const cert = certs.items.find((item) => item.id === state.certId);
  const availableKeys = keys.items.filter(
    (key) => cert === undefined || key.appleTeamId === cert.appleTeamId,
  );
  if (availableKeys.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No ASC API Key linked to this Apple Team. Upload one on the Credentials page.
      </p>
    );
  }
  const ascKeyLabels: Record<string, string> = Object.fromEntries(
    availableKeys.map((key) => [key.id, `${key.name} (${key.keyId})`]),
  );
  return (
    <div className="flex flex-col gap-3">
      <Field>
        <FieldLabel htmlFor="wiz-asc">ASC API Key</FieldLabel>
        <Select
          items={ascKeyLabels}
          value={state.ascKeyId}
          onValueChange={(value) => {
            onChange({ ...state, ascKeyId: typeof value === "string" ? value : "" });
          }}
        >
          <SelectTrigger id="wiz-asc">
            <SelectValue placeholder="Select an ASC API Key" />
          </SelectTrigger>
          <SelectPopup>
            {availableKeys.map((key) => (
              <SelectItem key={key.id} value={key.id}>
                {key.name} ({key.keyId})
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="wiz-bundle">Bundle Identifier</FieldLabel>
        <Input
          id="wiz-bundle"
          value={state.bundleIdentifier}
          onChange={(event) => {
            onChange({ ...state, bundleIdentifier: event.target.value });
          }}
          placeholder="com.example.app"
        />
        <FieldError
          match={state.bundleIdentifier.length > 0 && !BUNDLE_PATTERN.test(state.bundleIdentifier)}
        >
          Invalid bundle identifier
        </FieldError>
      </Field>
      <Button
        type="button"
        onClick={onGenerate}
        disabled={
          isGenerating ||
          state.ascKeyId.length === 0 ||
          !BUNDLE_PATTERN.test(state.bundleIdentifier) ||
          state.deviceIds.length === 0
        }
      >
        <WandIcon data-icon="inline-start" />
        {isGenerating ? "Generating..." : "Generate Profile via ASC API"}
      </Button>
      {state.profileId === null ? null : (
        <p className="text-muted-foreground text-xs">
          Profile generated. Continue to save the bundle configuration.
        </p>
      )}
    </div>
  );
};

const StepSave = ({ state }: { state: WizardState }) => (
  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
    <dt className="text-muted-foreground">Bundle</dt>
    <dd className="font-mono">{state.bundleIdentifier}</dd>
    <dt className="text-muted-foreground">Distribution</dt>
    <dd>AD_HOC</dd>
    <dt className="text-muted-foreground">Devices</dt>
    <dd>{state.deviceIds.length}</dd>
    <dt className="text-muted-foreground">Profile</dt>
    <dd>{state.profileId === null ? "—" : "Generated"}</dd>
  </dl>
);

const SaveButton = ({
  orgId,
  state,
  saveMutation,
}: {
  orgId: string;
  state: WizardState;
  saveMutation: {
    isPending: boolean;
    mutateAsync: (params: { cert: { appleTeamId: string }; profileId: string }) => Promise<unknown>;
  };
}) => {
  const { data: certs } = useSuspenseQuery(appleDistributionCertificatesQueryOptions(orgId));
  const cert = certs.items.find((item) => item.id === state.certId);
  const disabled = saveMutation.isPending || state.profileId === null || cert === undefined;
  return (
    <Button
      disabled={disabled}
      onClick={async () => {
        if (cert === undefined || state.profileId === null) {
          return;
        }
        await safeSubmit(
          saveMutation.mutateAsync({
            cert: { appleTeamId: cert.appleTeamId },
            profileId: state.profileId,
          }),
        );
      }}
    >
      {saveMutation.isPending ? "Saving..." : "Save"}
    </Button>
  );
};

export const AdHocIosWizard = ({ orgId, projectId }: { orgId: string; projectId: string }) => {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [state, setState] = useState<WizardState>(INITIAL);
  const queryClient = useQueryClient();

  const reset = () => {
    setStep(1);
    setState(INITIAL);
  };

  const generateMutation = useApiMutation({
    mutationFn: generateAppleProvisioningProfile,
    onSuccess: async (profile) => {
      setState((prev) => ({ ...prev, profileId: profile.id }));
      await queryClient.invalidateQueries({
        queryKey: appleProvisioningProfilesQueryOptions(orgId).queryKey,
      });
      toastManager.add({ title: "Provisioning profile generated", type: "success" });
    },
  });

  const saveMutation = useApiMutation({
    mutationFn: async (params: { cert: { appleTeamId: string }; profileId: string }) =>
      createIosBundleConfiguration(projectId, {
        bundleIdentifier: state.bundleIdentifier,
        distributionType: "AD_HOC",
        appleTeamId: params.cert.appleTeamId,
        appleDistributionCertificateId: state.certId,
        appleProvisioningProfileId: params.profileId,
        ascApiKeyId: state.ascKeyId,
      }),
    onSuccess: async () => {
      toastManager.add({ title: "Ad-Hoc bundle configuration saved", type: "success" });
      await queryClient.invalidateQueries({
        queryKey: iosBundleConfigurationsQueryOptions(orgId, projectId).queryKey,
      });
      setOpen(false);
      reset();
    },
  });

  const canAdvance = () => {
    if (step === 1) {
      return state.certId.length > 0;
    }
    if (step === 2) {
      return state.deviceIds.length > 0;
    }
    if (step === 3) {
      return state.profileId !== null;
    }
    return false;
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) {
          reset();
        }
      }}
    >
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
        }}
      >
        <WandIcon data-icon="inline-start" />
        Ad-Hoc Wizard
      </Button>
      <DialogPopup className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Ad-Hoc iOS Bundle</DialogTitle>
          <DialogDescription>
            Generate an Ad-Hoc provisioning profile and save the iOS bundle configuration.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <StepperHeader steps={STEPS} currentStep={step} />
          {step === 1 ? <StepCertificate orgId={orgId} state={state} onChange={setState} /> : null}
          {step === 2 ? <StepDevices orgId={orgId} state={state} onChange={setState} /> : null}
          {step === 3 ? (
            <StepProfile
              orgId={orgId}
              state={state}
              onChange={setState}
              isGenerating={generateMutation.isPending}
              onGenerate={async () => {
                await safeSubmit(
                  generateMutation.mutateAsync({
                    ascApiKeyId: state.ascKeyId,
                    appleDistributionCertificateId: state.certId,
                    bundleIdentifier: state.bundleIdentifier,
                    distributionType: "AD_HOC",
                    deviceIds: state.deviceIds,
                  }),
                );
              }}
            />
          ) : null}
          {step === 4 ? <StepSave state={state} /> : null}
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          {step > 1 ? (
            <Button
              variant="outline"
              onClick={() => {
                setStep((prev) => prev - 1);
              }}
            >
              Back
            </Button>
          ) : null}
          {step < STEPS.length ? (
            <Button
              disabled={!canAdvance()}
              onClick={() => {
                setStep((prev) => prev + 1);
              }}
            >
              Next
            </Button>
          ) : (
            <SaveButton orgId={orgId} state={state} saveMutation={saveMutation} />
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
