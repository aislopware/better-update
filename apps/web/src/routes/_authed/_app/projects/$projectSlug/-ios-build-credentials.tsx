import { APPLE_CERTIFICATE_TYPE_LABELS, isMacosCertificateType } from "@better-update/api";
import {
  appleDistributionCertificatesQueryOptions,
  appleProvisioningProfilesQueryOptions,
  appleTeamsQueryOptions,
  iosBundleConfigurationsQueryOptions,
} from "@better-update/api-client/react";
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
import { DetailStat, DetailStatStrip } from "../../../../../components/detail-stats";
import { SectionTitle } from "../../../../../components/page-header";
import { CopyableMono } from "../../../../../lib/copy-button";
import { RelativeTime } from "../../../../../lib/relative-time";
import { CredentialSection, EmptyBindingMessage } from "./-credential-section";
import {
  DISTRIBUTION_LABELS,
  sharedAppleTeamId,
  sortConfigsByDistribution,
} from "./-ios-detail-shared";

const CertCard = ({
  cert,
  team,
}: {
  cert: AppleDistributionCertificateItem | null;
  team: AppleTeamItem | null;
}) => (
  <CredentialSection
    title="Distribution certificate"
    badges={cert ? <ProtectedMark isProtected={cert.protected} /> : undefined}
  >
    {cert === null ? (
      <EmptyBindingMessage message="No distribution certificate bound — bind one with the CLI." />
    ) : (
      <DetailStatStrip columns={4}>
        <DetailStat label="Serial">
          <CopyableMono value={cert.serialNumber} label="Serial" />
        </DetailStat>
        {/* An iOS build cannot be signed with a macOS certificate, and binding
            one is rejected now — but a binding made before the certificate type
            was recorded (mig 0101) can still be here, and silence about it would
            leave a build failing at codesign with nothing on this page to
            explain why. */}
        {isMacosCertificateType(cert.certificateType) ? (
          <DetailStat label="Certificate">
            <span className="text-kumo-danger truncate text-xs">
              {APPLE_CERTIFICATE_TYPE_LABELS[cert.certificateType]} — not valid for iOS
            </span>
          </DetailStat>
        ) : null}
        {team ? (
          <DetailStat label="Apple Team">
            <TeamCell team={team} />
          </DetailStat>
        ) : null}
        <DetailStat label="Expires">
          <ExpiryCell validUntil={cert.validUntil} />
        </DetailStat>
        <DetailStat label="Updated">
          <span className="text-kumo-subtle">
            <RelativeTime value={cert.updatedAt} />
          </span>
        </DetailStat>
      </DetailStatStrip>
    )}
  </CredentialSection>
);

const ProfileCard = ({
  profile,
  team,
}: {
  profile: AppleProvisioningProfileItem | null;
  team: AppleTeamItem | null;
}) => (
  <CredentialSection
    title="Provisioning profile"
    badges={profile ? <ProtectedMark isProtected={profile.protected} /> : undefined}
  >
    {profile === null ? (
      <EmptyBindingMessage message="No provisioning profile bound — bind one with the CLI." />
    ) : (
      <DetailStatStrip columns={4}>
        <DetailStat label="Name">
          <span className="truncate font-medium">
            {profile.profileName ?? profile.developerPortalIdentifier ?? "Unnamed profile"}
          </span>
        </DetailStat>
        {team ? (
          <DetailStat label="Apple Team">
            <TeamCell team={team} />
          </DetailStat>
        ) : null}
        <DetailStat label="Expires">
          <ExpiryCell validUntil={profile.validUntil} />
        </DetailStat>
        <DetailStat label="Updated">
          <span className="text-kumo-subtle">
            <RelativeTime value={profile.updatedAt} />
          </span>
        </DetailStat>
      </DetailStatStrip>
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
      <CertCard cert={cert} team={team} />
      <ProfileCard profile={profile} team={team} />
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
      {/* No sentence under the heading: it named the two panels below it and
          the tab strip between them, all three of which say it themselves. */}
      <div className="flex flex-wrap items-baseline gap-2">
        <SectionTitle>Build credentials</SectionTitle>
        {/* A strip of one tab is a control that offers no choice. Most bundles
            ship a single distribution type, and then it is a fact about the
            credentials below rather than a switch between them. */}
        {configs.length > 1 ? null : (
          <span className="text-kumo-subtle text-sm">
            {DISTRIBUTION_LABELS[activeConfig.distributionType]}
          </span>
        )}
      </div>
      {configs.length > 1 ? (
        <Tabs
          tabs={configs.map((config) => ({
            value: config.distributionType,
            label: DISTRIBUTION_LABELS[config.distributionType],
          }))}
          value={activeConfig.distributionType}
          onValueChange={setSelectedType}
          className="self-start"
        />
      ) : null}
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
