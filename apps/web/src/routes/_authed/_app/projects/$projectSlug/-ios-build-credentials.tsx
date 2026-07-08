import {
  appleDistributionCertificatesQueryOptions,
  appleProvisioningProfilesQueryOptions,
  appleTeamsQueryOptions,
  iosBundleConfigurationsQueryOptions,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@better-update/ui/components/ui/tabs";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Fragment } from "react";

import type {
  AppleDistributionCertificateItem,
  AppleProvisioningProfileItem,
  AppleTeamItem,
  IosBundleConfigurationItem,
} from "@better-update/api-client/react";
import type { ComponentProps } from "react";

import { ProtectedBadgeCell, TeamCell } from "../../-credential-cells";
import { CopyableMono } from "../../../../../lib/copy-button";
import { deriveExpiryStatus } from "../../../../../lib/credential-status";
import { formatShortDate, formatShortDateTime } from "../../../../../lib/format-date";
import { CredentialSection, EmptyBindingMessage } from "./-credential-section";
import { DISTRIBUTION_LABELS, sortConfigsByDistribution } from "./-ios-detail-shared";

import type { CredentialStatus, CredentialStatusTone } from "../../../../../lib/credential-status";

const STATUS_BADGE_VARIANT: Record<CredentialStatusTone, ComponentProps<typeof Badge>["variant"]> =
  {
    error: "destructive",
    muted: "outline",
    success: "success",
    warning: "warning",
  };

const StatusBadge = ({ status }: { status: CredentialStatus }) => (
  <Badge variant={STATUS_BADGE_VARIANT[status.tone]}>{status.label}</Badge>
);

const CertRow = ({
  cert,
  team,
}: {
  cert: AppleDistributionCertificateItem;
  team: AppleTeamItem | null;
}) => {
  const certStatus = deriveExpiryStatus(cert.validUntil);
  return (
    <TableRow>
      <TableCell>
        <CopyableMono value={cert.serialNumber} label="Serial" />
      </TableCell>
      <TableCell>
        <TeamCell team={team} />
      </TableCell>
      <TableCell>
        <ProtectedBadgeCell isProtected={cert.protected} />
      </TableCell>
      <TableCell>
        <CopyableMono value={cert.developerIdIdentifier} label="Developer ID" />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <span>{formatShortDate(cert.validUntil)}</span>
          <StatusBadge status={certStatus} />
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">{formatShortDateTime(cert.updatedAt)}</TableCell>
    </TableRow>
  );
};

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
            <TableHead>Apple Team</TableHead>
            <TableHead>Protected</TableHead>
            <TableHead>Developer ID</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead>Updated at</TableHead>
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
}) => {
  const profileStatus = deriveExpiryStatus(profile.validUntil);
  return (
    <TableRow>
      <TableCell className="font-medium">
        {profile.profileName ?? profile.developerPortalIdentifier ?? "Unnamed profile"}
      </TableCell>
      <TableCell>
        <TeamCell team={team} />
      </TableCell>
      <TableCell>
        <ProtectedBadgeCell isProtected={profile.protected} />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <span>{profile.validUntil === null ? "—" : formatShortDate(profile.validUntil)}</span>
          <StatusBadge status={profileStatus} />
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {formatShortDateTime(profile.updatedAt)}
      </TableCell>
    </TableRow>
  );
};

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
            <TableHead>Apple Team</TableHead>
            <TableHead>Protected</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead>Updated at</TableHead>
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
}: {
  config: IosBundleConfigurationItem;
  certs: readonly AppleDistributionCertificateItem[];
  profiles: readonly AppleProvisioningProfileItem[];
  teams: readonly AppleTeamItem[];
}) => {
  const cert = findCert(certs, config.appleDistributionCertificateId);
  const profile = findProfile(profiles, config.appleProvisioningProfileId);
  const team = findTeam(teams, config.appleTeamId);

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

  const [firstConfig] = configs;
  if (firstConfig === undefined) {
    return null;
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-base leading-none font-semibold">Build credentials</h2>
        <p className="text-muted-foreground text-sm">
          Distribution certificate and provisioning profile per distribution type.
        </p>
      </div>
      <Tabs defaultValue={firstConfig.distributionType}>
        <TabsList>
          {configs.map((config) => (
            <TabsTrigger key={config.id} value={config.distributionType}>
              {DISTRIBUTION_LABELS[config.distributionType]}
            </TabsTrigger>
          ))}
        </TabsList>
        {configs.map((config) => (
          <Fragment key={config.id}>
            <TabsContent value={config.distributionType} className="pt-4">
              <ConfigTabPanel
                config={config}
                certs={certsResult.items}
                profiles={profilesResult.items}
                teams={teamsResult.items}
              />
            </TabsContent>
          </Fragment>
        ))}
      </Tabs>
    </section>
  );
};
