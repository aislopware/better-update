import {
  appleDistributionCertificatesQueryOptions,
  appleProvisioningProfilesQueryOptions,
  appleTeamsQueryOptions,
  iosBundleConfigurationsQueryOptions,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import {
  Card,
  CardFrame,
  CardFrameHeader,
  CardFrameTitle,
  CardPanel,
} from "@better-update/ui/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@better-update/ui/components/ui/tabs";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Fragment } from "react";

import type {
  AppleDistributionCertificateItem,
  AppleProvisioningProfileItem,
  AppleTeamItem,
  IosBundleConfigurationItem,
} from "@better-update/api-client/react";

import { EmptyDash, TeamCell } from "../../-credential-cells";
import { formatAppleTeamLabel } from "../../-credentials-utils";
import { STATUS_BADGE_VARIANT, deriveExpiryStatus } from "../../../../../lib/credential-status";
import { formatShortDate } from "../../../../../lib/format-date";
import { DISTRIBUTION_LABELS, sortConfigsByDistribution } from "./-ios-detail-shared";

const EmptyBindingCard = ({ message }: { message: string }) => (
  <Card>
    <CardPanel className="py-4">
      <span className="text-muted-foreground text-sm">{message}</span>
    </CardPanel>
  </Card>
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
      <TableCell className="font-mono text-xs break-all">{cert.serialNumber}</TableCell>
      <TableCell>
        <TeamCell team={team} />
      </TableCell>
      <TableCell className="font-mono text-xs">
        {cert.developerIdIdentifier ?? <EmptyDash />}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <span>{formatShortDate(cert.validUntil)}</span>
          <Badge variant={STATUS_BADGE_VARIANT[certStatus.tone]}>{certStatus.label}</Badge>
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">{formatShortDate(cert.updatedAt)}</TableCell>
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
  <CardFrame>
    <CardFrameHeader className="py-4">
      <CardFrameTitle className="text-base">Distribution certificate</CardFrameTitle>
    </CardFrameHeader>
    {cert === null ? (
      <EmptyBindingCard message="No distribution certificate bound — bind one with the CLI." />
    ) : (
      <Table variant="card">
        <TableHeader>
          <TableRow>
            <TableHead>Serial</TableHead>
            <TableHead>Apple Team</TableHead>
            <TableHead>Developer ID</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead>Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <CertRow cert={cert} team={team} />
        </TableBody>
      </Table>
    )}
  </CardFrame>
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
        <div className="flex items-center gap-2">
          <span>{profile.validUntil === null ? "—" : formatShortDate(profile.validUntil)}</span>
          <Badge variant={STATUS_BADGE_VARIANT[profileStatus.tone]}>{profileStatus.label}</Badge>
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">{formatShortDate(profile.updatedAt)}</TableCell>
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
  <CardFrame>
    <CardFrameHeader className="py-4">
      <CardFrameTitle className="text-base">Provisioning profile</CardFrameTitle>
    </CardFrameHeader>
    {profile === null ? (
      <EmptyBindingCard message="No provisioning profile bound — bind one with the CLI." />
    ) : (
      <Table variant="card">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Apple Team</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead>Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <ProfileRow profile={profile} team={team} />
        </TableBody>
      </Table>
    )}
  </CardFrame>
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
      <p className="text-muted-foreground text-sm">
        Team: <span className="text-foreground">{team ? formatAppleTeamLabel(team) : "—"}</span>
      </p>
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
            <TabsTab key={config.id} value={config.distributionType}>
              {DISTRIBUTION_LABELS[config.distributionType]}
            </TabsTab>
          ))}
        </TabsList>
        {configs.map((config) => (
          <Fragment key={config.id}>
            <TabsPanel value={config.distributionType} className="pt-4">
              <ConfigTabPanel
                config={config}
                certs={certsResult.items}
                profiles={profilesResult.items}
                teams={teamsResult.items}
              />
            </TabsPanel>
          </Fragment>
        ))}
      </Tabs>
    </section>
  );
};
