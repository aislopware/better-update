import {
  appleDistributionCertificatesQueryOptions,
  appleProvisioningProfilesQueryOptions,
  applePushKeysQueryOptions,
  appleTeamsQueryOptions,
  ascApiKeysQueryOptions,
  devicesQueryOptions,
} from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import { Field, FieldError, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import {
  Select,
  SelectPopup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { useSuspenseQuery } from "@tanstack/react-query";
import { WandIcon } from "lucide-react";

import { formatAppleTeamLabel } from "../../-credentials-utils";
import { BUNDLE_PATTERN } from "./-ios-wizard-state";

import type { DistributionType, WizardState } from "./-ios-wizard-state";

const DISTRIBUTION_LABELS: Record<DistributionType, string> = {
  APP_STORE: "App Store",
  DEVELOPMENT: "Development",
  ENTERPRISE: "Enterprise",
};

export const StepBundle = ({
  state,
  onChange,
}: {
  state: WizardState;
  onChange: (next: WizardState) => void;
}) => (
  <div className="flex flex-col gap-3">
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
    <Field>
      <FieldLabel htmlFor="wiz-dist">Distribution Type</FieldLabel>
      <Select
        items={DISTRIBUTION_LABELS}
        value={state.distributionType}
        onValueChange={(value) => {
          const next: DistributionType =
            value === "APP_STORE" || value === "DEVELOPMENT" || value === "ENTERPRISE"
              ? value
              : "APP_STORE";
          onChange({ ...state, distributionType: next });
        }}
      >
        <SelectTrigger id="wiz-dist">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value="APP_STORE">App Store</SelectItem>
          <SelectItem value="DEVELOPMENT">Development</SelectItem>
          <SelectItem value="ENTERPRISE">Enterprise</SelectItem>
        </SelectPopup>
      </Select>
    </Field>
  </div>
);

export const StepTeam = ({
  orgId,
  state,
  onChange,
}: {
  orgId: string;
  state: WizardState;
  onChange: (next: WizardState) => void;
}) => {
  const { data } = useSuspenseQuery(appleTeamsQueryOptions(orgId));
  if (data.items.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No Apple Teams yet. Upload a credential first to create a team.
      </p>
    );
  }
  const teamLabels: Record<string, string> = Object.fromEntries(
    data.items.map((team) => [team.id, formatAppleTeamLabel(team)]),
  );
  return (
    <Field>
      <FieldLabel htmlFor="wiz-team">Apple Team</FieldLabel>
      <Select
        items={teamLabels}
        value={state.appleTeamId}
        onValueChange={(value) => {
          onChange({
            ...state,
            appleTeamId: typeof value === "string" ? value : "",
            certId: "",
            pushKeyId: "",
            ascKeyId: "",
            profileId: "",
            deviceIds: [],
          });
        }}
      >
        <SelectTrigger id="wiz-team">
          <SelectValue placeholder="Select a team" />
        </SelectTrigger>
        <SelectPopup>
          {data.items.map((team) => (
            <SelectItem key={team.id} value={team.id}>
              {formatAppleTeamLabel(team)}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </Field>
  );
};

export const StepCert = ({
  orgId,
  state,
  onChange,
}: {
  orgId: string;
  state: WizardState;
  onChange: (next: WizardState) => void;
}) => {
  const { data } = useSuspenseQuery(appleDistributionCertificatesQueryOptions(orgId));
  const candidates = data.items.filter((cert) => cert.appleTeamId === state.appleTeamId);
  if (candidates.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No Distribution Certificates for this team. Upload one on the Credentials page.
      </p>
    );
  }
  const certLabels: Record<string, string> = Object.fromEntries(
    candidates.map((cert) => [cert.id, `${cert.serialNumber.slice(0, 16)}...`]),
  );
  return (
    <Field>
      <FieldLabel htmlFor="wiz-cert">Distribution Certificate</FieldLabel>
      <Select
        items={certLabels}
        value={state.certId}
        onValueChange={(value) => {
          onChange({ ...state, certId: typeof value === "string" ? value : "", profileId: "" });
        }}
      >
        <SelectTrigger id="wiz-cert">
          <SelectValue placeholder="Select a certificate" />
        </SelectTrigger>
        <SelectPopup>
          {candidates.map((cert) => (
            <SelectItem key={cert.id} value={cert.id}>
              {cert.serialNumber.slice(0, 16)}...
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </Field>
  );
};

export const StepPush = ({
  orgId,
  state,
  onChange,
}: {
  orgId: string;
  state: WizardState;
  onChange: (next: WizardState) => void;
}) => {
  const { data } = useSuspenseQuery(applePushKeysQueryOptions(orgId));
  const candidates = data.items.filter((key) => key.appleTeamId === state.appleTeamId);
  const pushKeyLabels: Record<string, string> = Object.fromEntries(
    candidates.map((key) => [key.id, key.keyId]),
  );
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-xs">
        Push Keys are optional. Leave empty to skip binding.
      </p>
      {candidates.length === 0 ? (
        <p className="text-muted-foreground text-sm">No Push Keys for this team.</p>
      ) : (
        <Field>
          <FieldLabel htmlFor="wiz-push">Push Key</FieldLabel>
          <Select
            items={pushKeyLabels}
            value={state.pushKeyId}
            onValueChange={(value) => {
              onChange({ ...state, pushKeyId: typeof value === "string" ? value : "" });
            }}
          >
            <SelectTrigger id="wiz-push">
              <SelectValue placeholder="(none)" />
            </SelectTrigger>
            <SelectPopup>
              {candidates.map((key) => (
                <SelectItem key={key.id} value={key.id}>
                  {key.keyId}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </Field>
      )}
    </div>
  );
};

export const StepAsc = ({
  orgId,
  state,
  onChange,
}: {
  orgId: string;
  state: WizardState;
  onChange: (next: WizardState) => void;
}) => {
  const { data } = useSuspenseQuery(ascApiKeysQueryOptions(orgId));
  const candidates = data.items.filter((key) => key.appleTeamId === state.appleTeamId);
  if (candidates.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No ASC API Keys for this team. Upload one on the Credentials page.
      </p>
    );
  }
  const ascKeyLabels: Record<string, string> = Object.fromEntries(
    candidates.map((key) => [key.id, `${key.name} (${key.keyId})`]),
  );
  return (
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
          <SelectValue placeholder="Select a key" />
        </SelectTrigger>
        <SelectPopup>
          {candidates.map((key) => (
            <SelectItem key={key.id} value={key.id}>
              {key.name} ({key.keyId})
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </Field>
  );
};

const DevicesPicker = ({
  orgId,
  teamId,
  selected,
  onChange,
}: {
  orgId: string;
  teamId: string;
  selected: readonly string[];
  onChange: (next: readonly string[]) => void;
}) => {
  const { data } = useSuspenseQuery(
    devicesQueryOptions(orgId, { limit: 100, appleTeamId: teamId }),
  );
  const { items } = data;
  const set = new Set(selected);
  return (
    <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border p-2">
      {items.map((device) => {
        const isSelected = set.has(device.id);
        return (
          <button
            key={device.id}
            type="button"
            onClick={() => {
              const next = new Set(set);
              if (next.has(device.id)) {
                next.delete(device.id);
              } else {
                next.add(device.id);
              }
              onChange([...next]);
            }}
            className="hover:bg-muted flex items-center justify-between rounded-sm px-2 py-1 text-left text-xs"
            aria-pressed={isSelected}
          >
            <span>{device.name}</span>
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
  );
};

const profileLabel = (profile: {
  profileName: string | null;
  developerPortalIdentifier: string | null;
  id: string;
}): string => {
  if (profile.profileName !== null) {
    return profile.profileName;
  }
  if (profile.developerPortalIdentifier !== null) {
    return profile.developerPortalIdentifier;
  }
  return profile.id;
};

export const StepProfile = ({
  orgId,
  state,
  onChange,
  onGenerate,
  isGenerating,
}: {
  orgId: string;
  state: WizardState;
  onChange: (next: WizardState) => void;
  onGenerate: () => void | Promise<void>;
  isGenerating: boolean;
}) => {
  const { data } = useSuspenseQuery(
    appleProvisioningProfilesQueryOptions(orgId, {
      bundleIdentifier: state.bundleIdentifier,
      distributionType: state.distributionType,
      appleTeamId: state.appleTeamId,
    }),
  );
  const profileLabels: Record<string, string> = Object.fromEntries(
    data.items.map((profile) => [profile.id, profileLabel(profile)]),
  );
  return (
    <div className="flex flex-col gap-3">
      {data.items.length > 0 ? (
        <Field>
          <FieldLabel htmlFor="wiz-profile">Existing profile</FieldLabel>
          <Select
            items={profileLabels}
            value={state.profileId}
            onValueChange={(value) => {
              onChange({ ...state, profileId: typeof value === "string" ? value : "" });
            }}
          >
            <SelectTrigger id="wiz-profile">
              <SelectValue placeholder="Select or generate below" />
            </SelectTrigger>
            <SelectPopup>
              {data.items.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  {profileLabel(profile)}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </Field>
      ) : (
        <p className="text-muted-foreground text-sm">
          No existing profile for this bundle + distribution. Generate below.
        </p>
      )}
      {state.distributionType === "DEVELOPMENT" ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">Development devices</p>
          <DevicesPicker
            orgId={orgId}
            teamId={state.appleTeamId}
            selected={state.deviceIds}
            onChange={(next) => {
              onChange({ ...state, deviceIds: next });
            }}
          />
        </div>
      ) : null}
      <Button
        type="button"
        onClick={onGenerate}
        disabled={isGenerating || state.ascKeyId.length === 0 || state.certId.length === 0}
      >
        <WandIcon data-icon="inline-start" />
        {isGenerating ? "Generating..." : "Generate via ASC API"}
      </Button>
    </div>
  );
};

export const StepReview = ({ state }: { state: WizardState }) => (
  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
    <dt className="text-muted-foreground">Bundle</dt>
    <dd className="font-mono">{state.bundleIdentifier}</dd>
    <dt className="text-muted-foreground">Distribution</dt>
    <dd>{state.distributionType}</dd>
    <dt className="text-muted-foreground">Team</dt>
    <dd className="font-mono">{state.appleTeamId.slice(0, 12)}...</dd>
    <dt className="text-muted-foreground">Cert</dt>
    <dd>{state.certId.length > 0 ? "bound" : "—"}</dd>
    <dt className="text-muted-foreground">Push</dt>
    <dd>{state.pushKeyId.length > 0 ? "bound" : "—"}</dd>
    <dt className="text-muted-foreground">ASC</dt>
    <dd>{state.ascKeyId.length > 0 ? "bound" : "—"}</dd>
    <dt className="text-muted-foreground">Profile</dt>
    <dd>{state.profileId.length > 0 ? "bound" : "—"}</dd>
  </dl>
);
