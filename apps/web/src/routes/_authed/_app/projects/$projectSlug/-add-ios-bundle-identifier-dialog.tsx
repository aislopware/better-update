import {
  appleDistributionCertificatesQueryOptions,
  appleProvisioningProfilesQueryOptions,
  applePushKeysQueryOptions,
  appleTeamsQueryOptions,
  ascApiKeysQueryOptions,
  createIosBundleConfiguration,
  iosBundleConfigurationsQueryOptions,
} from "@better-update/api-client/react";
import { compact } from "@better-update/type-guards";
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
  DialogTrigger,
} from "@better-update/ui/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useSuspenseQuery } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { Suspense, useState } from "react";

import type { ReactNode } from "react";

import { formatAppleTeamLabel } from "../../-credentials-utils";
import { safeSubmit, useApiMutation } from "../../../../../lib/use-api-mutation";

const BUNDLE_PATTERN = /^[A-Za-z0-9.\-_]{1,200}$/u;

const DISTRIBUTION_TYPES = [
  { value: "APP_STORE", label: "App Store" },
  { value: "AD_HOC", label: "Ad-Hoc" },
  { value: "DEVELOPMENT", label: "Development" },
  { value: "ENTERPRISE", label: "Enterprise" },
] as const;

type DistributionTypeValue = (typeof DISTRIBUTION_TYPES)[number]["value"];

interface FormState {
  readonly bundleIdentifier: string;
  readonly distributionType: DistributionTypeValue;
  readonly appleTeamId: string;
  readonly appleDistributionCertificateId: string;
  readonly appleProvisioningProfileId: string;
  readonly applePushKeyId: string;
  readonly ascApiKeyId: string;
  readonly targetName: string;
  readonly parentBundleIdentifier: string;
}

const INITIAL: FormState = {
  bundleIdentifier: "",
  distributionType: "APP_STORE",
  appleTeamId: "",
  appleDistributionCertificateId: "",
  appleProvisioningProfileId: "",
  applePushKeyId: "",
  ascApiKeyId: "",
  targetName: "",
  parentBundleIdentifier: "",
};

const NONE_VALUE = "__none__";

const optionalIdFromSelect = (value: string): string | undefined => {
  if (value === "" || value === NONE_VALUE) {
    return undefined;
  }
  return value;
};

const OptionalCredentialSelect = <T extends { readonly id: string }>({
  id,
  label,
  value,
  onValueChange,
  disabled,
  items,
  renderLabel,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onValueChange: (next: string) => void;
  readonly disabled: boolean;
  readonly items: readonly T[];
  readonly renderLabel: (item: T) => ReactNode;
}) => (
  <Field>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Select
      value={value === "" ? NONE_VALUE : value}
      onValueChange={(next) => {
        const normalized = typeof next === "string" ? next : NONE_VALUE;
        onValueChange(normalized === NONE_VALUE ? "" : normalized);
      }}
      disabled={disabled}
    >
      <SelectTrigger id={id}>
        <SelectValue placeholder="None — bind later" />
      </SelectTrigger>
      <SelectPopup>
        <SelectItem value={NONE_VALUE}>None — bind later</SelectItem>
        {items.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            {renderLabel(item)}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  </Field>
);

const FormBody = ({
  orgId,
  projectId,
  state,
  onChange,
}: {
  readonly orgId: string;
  readonly projectId: string;
  readonly state: FormState;
  readonly onChange: (next: FormState) => void;
}) => {
  const { data: teams } = useSuspenseQuery(appleTeamsQueryOptions(orgId));
  const { data: certs } = useSuspenseQuery(appleDistributionCertificatesQueryOptions(orgId));
  const { data: profiles } = useSuspenseQuery(
    appleProvisioningProfilesQueryOptions(orgId, {
      ...compact({ bundleIdentifier: state.bundleIdentifier || undefined }),
      distributionType: state.distributionType,
    }),
  );
  const { data: pushKeys } = useSuspenseQuery(applePushKeysQueryOptions(orgId));
  const { data: ascKeys } = useSuspenseQuery(ascApiKeysQueryOptions(orgId));
  const { data: existingBundles } = useSuspenseQuery(
    iosBundleConfigurationsQueryOptions(orgId, projectId),
  );
  const candidateParents = [
    ...new Set(
      existingBundles.items
        .filter((entry) => entry.bundleIdentifier !== state.bundleIdentifier)
        .map((entry) => entry.bundleIdentifier),
    ),
  ].toSorted();

  const teamCerts = certs.items.filter((cert) =>
    state.appleTeamId === "" ? true : cert.appleTeamId === state.appleTeamId,
  );
  const teamProfiles = profiles.items.filter((profile) =>
    state.appleTeamId === "" ? true : profile.appleTeamId === state.appleTeamId,
  );
  const teamPushKeys = pushKeys.items.filter((key) =>
    state.appleTeamId === "" ? true : key.appleTeamId === state.appleTeamId,
  );
  const teamAscKeys = ascKeys.items.filter((key) =>
    state.appleTeamId === "" ? true : key.appleTeamId === state.appleTeamId,
  );

  const validBundle = BUNDLE_PATTERN.test(state.bundleIdentifier);

  return (
    <div className="flex flex-col gap-3">
      <Field>
        <FieldLabel htmlFor="bundle-identifier">Bundle identifier</FieldLabel>
        <Input
          id="bundle-identifier"
          value={state.bundleIdentifier}
          placeholder="com.example.app"
          onChange={(event) => {
            onChange({ ...state, bundleIdentifier: event.target.value });
          }}
        />
        <FieldError match={state.bundleIdentifier.length > 0 && !validBundle}>
          Reverse-domain style only (letters, digits, dot, dash)
        </FieldError>
      </Field>
      <Field>
        <FieldLabel htmlFor="distribution-type">Distribution type</FieldLabel>
        <Select
          value={state.distributionType}
          onValueChange={(value) => {
            const next = DISTRIBUTION_TYPES.find((entry) => entry.value === value);
            onChange({ ...state, distributionType: next?.value ?? "APP_STORE" });
          }}
        >
          <SelectTrigger id="distribution-type">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {DISTRIBUTION_TYPES.map((entry) => (
              <SelectItem key={entry.value} value={entry.value}>
                {entry.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="apple-team">Apple Team</FieldLabel>
        <Select
          value={state.appleTeamId}
          onValueChange={(value) => {
            onChange({
              ...state,
              appleTeamId: typeof value === "string" ? value : "",
              appleDistributionCertificateId: "",
              appleProvisioningProfileId: "",
              applePushKeyId: "",
              ascApiKeyId: "",
            });
          }}
        >
          <SelectTrigger id="apple-team">
            <SelectValue placeholder="Select an Apple Team" />
          </SelectTrigger>
          <SelectPopup>
            {teams.items.map((team) => (
              <SelectItem key={team.id} value={team.id}>
                {formatAppleTeamLabel(team)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <FieldError match={teams.items.length === 0}>
          Upload an Apple distribution certificate, push key, or ASC API key first to populate Apple
          Teams.
        </FieldError>
      </Field>
      <OptionalCredentialSelect
        id="dist-cert"
        label="Distribution certificate (optional)"
        value={state.appleDistributionCertificateId}
        onValueChange={(next) => {
          onChange({ ...state, appleDistributionCertificateId: next });
        }}
        disabled={state.appleTeamId === ""}
        items={teamCerts}
        renderLabel={(cert) => `${cert.serialNumber.slice(0, 16)}…`}
      />
      <OptionalCredentialSelect
        id="prov-profile"
        label="Provisioning profile (optional)"
        value={state.appleProvisioningProfileId}
        onValueChange={(next) => {
          onChange({ ...state, appleProvisioningProfileId: next });
        }}
        disabled={state.appleTeamId === ""}
        items={teamProfiles}
        renderLabel={(profile) =>
          profile.profileName ?? profile.developerPortalIdentifier ?? profile.id.slice(0, 8)
        }
      />
      <OptionalCredentialSelect
        id="push-key"
        label="Push Key (optional)"
        value={state.applePushKeyId}
        onValueChange={(next) => {
          onChange({ ...state, applePushKeyId: next });
        }}
        disabled={state.appleTeamId === ""}
        items={teamPushKeys}
        renderLabel={(key) => key.keyId}
      />
      <OptionalCredentialSelect
        id="asc-key"
        label="ASC API Key for EAS Submit (optional)"
        value={state.ascApiKeyId}
        onValueChange={(next) => {
          onChange({ ...state, ascApiKeyId: next });
        }}
        disabled={state.appleTeamId === ""}
        items={teamAscKeys}
        renderLabel={(key) => `${key.name} · ${key.keyId}`}
      />
      <Field>
        <FieldLabel htmlFor="target-name">Target name (optional)</FieldLabel>
        <Input
          id="target-name"
          value={state.targetName}
          placeholder="MyApp, MyAppNotificationServiceExtension, …"
          onChange={(event) => {
            onChange({ ...state, targetName: event.target.value });
          }}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="parent-bundle">Parent bundle (optional)</FieldLabel>
        <Select
          value={state.parentBundleIdentifier === "" ? NONE_VALUE : state.parentBundleIdentifier}
          onValueChange={(value) => {
            const next = typeof value === "string" ? value : NONE_VALUE;
            onChange({
              ...state,
              parentBundleIdentifier: next === NONE_VALUE ? "" : next,
            });
          }}
          disabled={candidateParents.length === 0}
        >
          <SelectTrigger id="parent-bundle">
            <SelectValue
              placeholder={
                candidateParents.length === 0
                  ? "No other bundle identifiers in this project"
                  : "None — top-level target"
              }
            />
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value={NONE_VALUE}>None — top-level target</SelectItem>
            {candidateParents.map((parent) => (
              <SelectItem key={parent} value={parent}>
                <span className="font-mono">{parent}</span>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </Field>
    </div>
  );
};

interface AddIosBundleIdentifierDialogProps {
  readonly orgId: string;
  readonly projectId: string;
  readonly onCreated: () => Promise<void>;
}

export const AddIosBundleIdentifierDialog = ({
  orgId,
  projectId,
  onCreated,
}: AddIosBundleIdentifierDialogProps) => {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<FormState>(INITIAL);
  const validBundle = BUNDLE_PATTERN.test(state.bundleIdentifier);
  const canSubmit = validBundle && state.appleTeamId !== "";

  const createMutation = useApiMutation({
    mutationFn: async () => {
      const trimmedTargetName = state.targetName.trim();
      const trimmedParent = state.parentBundleIdentifier.trim();
      return createIosBundleConfiguration(projectId, {
        bundleIdentifier: state.bundleIdentifier,
        distributionType: state.distributionType,
        appleTeamId: state.appleTeamId,
        ...compact({
          appleDistributionCertificateId: optionalIdFromSelect(
            state.appleDistributionCertificateId,
          ),
          appleProvisioningProfileId: optionalIdFromSelect(state.appleProvisioningProfileId),
          applePushKeyId: optionalIdFromSelect(state.applePushKeyId),
          ascApiKeyId: optionalIdFromSelect(state.ascApiKeyId),
          targetName: trimmedTargetName || undefined,
          parentBundleIdentifier: trimmedParent || undefined,
        }),
      });
    },
    onSuccess: async () => {
      toastManager.add({ title: "Bundle identifier added", type: "success" });
      await onCreated();
      setOpen(false);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(next) => {
        if (!next) {
          setState(INITIAL);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <PlusIcon data-icon="inline-start" />
            Add Bundle Identifier
          </Button>
        }
      />
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Bundle Identifier</DialogTitle>
          <DialogDescription>
            Register an iOS bundle identifier for this project. Optionally bind existing credentials
            now, or skip and bind from the detail page later.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Suspense
            fallback={<p className="text-muted-foreground text-sm">Loading credentials…</p>}
          >
            <FormBody orgId={orgId} projectId={projectId} state={state} onChange={setState} />
          </Suspense>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            disabled={!canSubmit}
            loading={createMutation.isPending}
            onClick={async () => {
              await safeSubmit(createMutation.mutateAsync(undefined));
            }}
          >
            Add bundle identifier
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
