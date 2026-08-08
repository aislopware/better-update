import {
  appleDistributionCertificatesQueryOptions,
  appleProvisioningProfilesQueryOptions,
  appleTeamsQueryOptions,
  iosBundleConfigurationsQueryOptions,
} from "@better-update/api-client/react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/table";
import { Tabs } from "@better-update/ui/components/tabs";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";

import type {
  AppleDistributionCertificateItem,
  AppleProvisioningProfileItem,
  AppleTeamItem,
  IosBundleConfigurationItem,
} from "@better-update/api-client/react";

import { ExpiryCell, ProtectedMark, TeamCell } from "../../-credential-cells";
import { CopyableMono } from "../../../../../lib/copy-button";
import { RelativeTime } from "../../../../../lib/relative-time";
import { CredentialSection, EmptyBindingMessage } from "./-credential-section";
import {
  DISTRIBUTION_LABELS,
  sharedAppleTeamId,
  sortConfigsByDistribution,
} from "./-ios-detail-shared";

const CertRow = ({
  cert,
  team,
}: {
  cert: AppleDistributionCertificateItem;
  team: AppleTeamItem | null;
}) => (
  <TableRow>
    <TableCell>
      <div className="flex items-center gap-2">
        <CopyableMono value={cert.serialNumber} label="Serial" />
        <ProtectedMark isProtected={cert.protected} />
      </div>
      {/* Only a Developer ID certificate has one, and then it is the thing that
          tells it apart from the App Store certificate above it. */}
      {cert.developerIdIdentifier ? (
        <span className="text-kumo-subtle text-xs">Developer ID {cert.developerIdIdentifier}</span>
      ) : null}
    </TableCell>
    {team ? (
      <TableCell>
        <TeamCell team={team} />
      </TableCell>
    ) : null}
    <TableCell>
      <ExpiryCell validUntil={cert.validUntil} />
    </TableCell>
    <TableCell className="text-kumo-subtle">
      <RelativeTime value={cert.updatedAt} />
    </TableCell>
  </TableRow>
);

const CertTableCard = ({
  cert,
  team,
}: {
  cert: AppleDistributionCertificateItem | null;
  team: AppleTeamItem | null;
}) => (
  <CredentialSection title="Distribution certificate">
    {cert === null ? (
      <EmptyBindingMessage message="No distribution certificate bound — bind one with the CLI." />
    ) : (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Serial</TableHead>
            {team ? <TableHead>Apple Team</TableHead> : null}
            <TableHead>Expires</TableHead>
            <TableHead>Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <CertRow cert={cert} team={team} />
        </TableBody>
      </Table>
    )}
  </CredentialSection>
);

const ProfileRow = ({
  profile,
  team,
}: {
  profile: AppleProvisioningProfileItem;
  team: AppleTeamItem | null;
}) => (
  <TableRow>
    <TableCell className="font-medium">
      <div className="flex items-center gap-2">
        {profile.profileName ?? profile.developerPortalIdentifier ?? "Unnamed profile"}
        <ProtectedMark isProtected={profile.protected} />
      </div>
    </TableCell>
    {team ? (
      <TableCell>
        <TeamCell team={team} />
      </TableCell>
    ) : null}
    <TableCell>
      <ExpiryCell validUntil={profile.validUntil} />
    </TableCell>
    <TableCell className="text-kumo-subtle">
      <RelativeTime value={profile.updatedAt} />
    </TableCell>
  </TableRow>
);

const ProfileTableCard = ({
  profile,
  team,
}: {
  profile: AppleProvisioningProfileItem | null;
  team: AppleTeamItem | null;
}) => (
  <CredentialSection title="Provisioning profile">
    {profile === null ? (
      <EmptyBindingMessage message="No provisioning profile bound — bind one with the CLI." />
    ) : (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            {team ? <TableHead>Apple Team</TableHead> : null}
            <TableHead>Expires</TableHead>
            <TableHead>Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <ProfileRow profile={profile} team={team} />
        </TableBody>
      </Table>
    )}
  </CredentialSection>
);

const findCert = (
  certs: readonly AppleDistributionCertificateItem[],
  id: string | null,
): AppleDistributionCertificateItem | null => {
  if (id === null) {
    return null;
  }
  const found = certs.find((cert) => cert.id === id);
  return found === undefined ? null : found;
};

const findProfile = (
  profiles: readonly AppleProvisioningProfileItem[],
  id: string | null,
): AppleProvisioningProfileItem | null => {
  if (id === null) {
    return null;
  }
  const found = profiles.find((profile) => profile.id === id);
  return found === undefined ? null : found;
};

const findTeam = (teams: readonly AppleTeamItem[], id: string): AppleTeamItem | null => {
  const found = teams.find((team) => team.id === id);
  return found === undefined ? null : found;
};

const ConfigTabPanel = ({
  config,
  certs,
  profiles,
  teams,
  showTeam,
}: {
  config: IosBundleConfigurationItem;
  certs: readonly AppleDistributionCertificateItem[];
  profiles: readonly AppleProvisioningProfileItem[];
  teams: readonly AppleTeamItem[];
  /** Only when the distributions disagree — otherwise the page header names it. */
  showTeam: boolean;
}) => {
  const cert = findCert(certs, config.appleDistributionCertificateId);
  const profile = findProfile(profiles, config.appleProvisioningProfileId);
  const team = showTeam ? findTeam(teams, config.appleTeamId) : null;

  return (
    <div className="flex flex-col gap-4">
      <CertTableCard cert={cert} team={team} />
      <ProfileTableCard profile={profile} team={team} />
    </div>
  );
};

export const IosBuildCredentialsSection = ({
  orgId,
  projectId,
  bundleIdentifier,
}: {
  orgId: string;
  projectId: string;
  bundleIdentifier: string;
}) => {
  const { data: configsResult } = useSuspenseQuery(
    iosBundleConfigurationsQueryOptions(orgId, projectId),
  );
  const { data: certsResult } = useSuspenseQuery(appleDistributionCertificatesQueryOptions(orgId));
  const { data: profilesResult } = useSuspenseQuery(
    appleProvisioningProfilesQueryOptions(orgId, { bundleIdentifier }),
  );
  const { data: teamsResult } = useSuspenseQuery(appleTeamsQueryOptions(orgId));

  const configs = sortConfigsByDistribution(
    configsResult.items.filter((config) => config.bundleIdentifier === bundleIdentifier),
  );
  // Kumo's Tabs renders the strip alone and leaves the panel to the caller, so
  // the selection lives here. Undefined means "not chosen yet" and resolves to
  // the first distribution type below.
  const [selectedType, setSelectedType] = useState<string>();

  const [firstConfig] = configs;
  if (firstConfig === undefined) {
    return null;
  }
  const activeConfig =
    configs.find((config) => config.distributionType === selectedType) ?? firstConfig;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-base leading-none font-semibold">Build credentials</h2>
        <p className="text-kumo-subtle text-sm">
          Distribution certificate and provisioning profile per distribution type.
        </p>
      </div>
      <Tabs
        tabs={configs.map((config) => ({
          value: config.distributionType,
          label: DISTRIBUTION_LABELS[config.distributionType],
        }))}
        value={activeConfig.distributionType}
        onValueChange={setSelectedType}
        className="self-start"
      />
      <ConfigTabPanel
        config={activeConfig}
        certs={certsResult.items}
        profiles={profilesResult.items}
        teams={teamsResult.items}
        showTeam={sharedAppleTeamId(configs) === null}
      />
    </section>
  );
};
