import {
  appleDistributionCertificatesQueryOptions,
  appleProvisioningProfilesQueryOptions,
  appleTeamsQueryOptions,
  deleteIosBundleConfiguration,
  iosBundleConfigurationsQueryOptions,
  updateIosBundleConfiguration,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Card,
  CardFrame,
  CardFrameHeader,
  CardFrameTitle,
  CardPanel,
} from "@better-update/ui/components/ui/card";
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@better-update/ui/components/ui/menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@better-update/ui/components/ui/tabs";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { EllipsisVerticalIcon, Trash2Icon } from "lucide-react";
import { Fragment, useState } from "react";

import type {
  AppleDistributionCertificateItem,
  AppleProvisioningProfileItem,
  AppleTeamItem,
  IosBundleConfigurationItem,
} from "@better-update/api-client/react";

import { formatAppleTeamLabel } from "../../-credentials-utils";
import { STATUS_BADGE_VARIANT, deriveExpiryStatus } from "../../../../../lib/credential-status";
import { formatDate } from "../../../../../lib/format-date";
import { useApiMutation } from "../../../../../lib/use-api-mutation";
import { ConfirmDeleteDialog } from "./-confirm-delete-dialog";
import { IosChangeCertDialog } from "./-ios-change-cert-dialog";
import { IosChangeProfileDialog } from "./-ios-change-profile-dialog";
import { DISTRIBUTION_LABELS, sortConfigsByDistribution } from "./-ios-detail-shared";

const RowKebab = ({
  ariaLabel,
  onChange,
  onRemove,
}: {
  ariaLabel: string;
  onChange: () => void;
  onRemove: () => void;
}) => (
  <Menu>
    <MenuTrigger render={<Button variant="ghost" size="icon" aria-label={ariaLabel} />}>
      <EllipsisVerticalIcon strokeWidth={2} />
    </MenuTrigger>
    <MenuPopup align="end">
      <MenuGroup>
        <MenuItem onClick={onChange}>Change</MenuItem>
      </MenuGroup>
      <MenuSeparator />
      <MenuGroup>
        <MenuItem variant="destructive" onClick={onRemove}>
          <Trash2Icon strokeWidth={2} />
          <span>Remove binding</span>
        </MenuItem>
      </MenuGroup>
    </MenuPopup>
  </Menu>
);

const EmptyBindingCard = ({
  message,
  actionLabel,
  onChange,
}: {
  message: string;
  actionLabel: string;
  onChange: () => void;
}) => (
  <Card>
    <CardPanel className="flex items-center justify-between gap-3 py-4">
      <span className="text-muted-foreground text-sm">{message}</span>
      <Button size="sm" variant="outline" onClick={onChange}>
        {actionLabel}
      </Button>
    </CardPanel>
  </Card>
);

const CertTableCard = ({
  cert,
  team,
  onChange,
  onRemove,
}: {
  cert: AppleDistributionCertificateItem | null;
  team: AppleTeamItem | null;
  onChange: () => void;
  onRemove: () => void;
}) => (
  <CardFrame>
    <CardFrameHeader className="py-4">
      <CardFrameTitle className="text-base">Distribution certificate</CardFrameTitle>
    </CardFrameHeader>
    {cert === null ? (
      <EmptyBindingCard
        message="No distribution certificate bound."
        actionLabel="Set distribution certificate"
        onChange={onChange}
      />
    ) : (
      <Table variant="card">
        <TableHeader>
          <TableRow>
            <TableHead>Serial</TableHead>
            <TableHead>Apple Team</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead className="w-12" aria-label="Actions" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <CertRow cert={cert} team={team} onChange={onChange} onRemove={onRemove} />
        </TableBody>
      </Table>
    )}
  </CardFrame>
);

const CertRow = ({
  cert,
  team,
  onChange,
  onRemove,
}: {
  cert: AppleDistributionCertificateItem;
  team: AppleTeamItem | null;
  onChange: () => void;
  onRemove: () => void;
}) => {
  const certStatus = deriveExpiryStatus(cert.validUntil);
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{cert.serialNumber.slice(0, 16)}…</TableCell>
      <TableCell>{team ? formatAppleTeamLabel(team) : cert.appleTeamId}</TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <span>{formatDate(cert.validUntil)}</span>
          <Badge variant={STATUS_BADGE_VARIANT[certStatus.tone]}>{certStatus.label}</Badge>
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">{formatDate(cert.updatedAt)}</TableCell>
      <TableCell className="text-right">
        <RowKebab
          ariaLabel="Distribution certificate actions"
          onChange={onChange}
          onRemove={onRemove}
        />
      </TableCell>
    </TableRow>
  );
};

const ProfileTableCard = ({
  profile,
  team,
  onChange,
  onRemove,
}: {
  profile: AppleProvisioningProfileItem | null;
  team: AppleTeamItem | null;
  onChange: () => void;
  onRemove: () => void;
}) => (
  <CardFrame>
    <CardFrameHeader className="py-4">
      <CardFrameTitle className="text-base">Provisioning profile</CardFrameTitle>
    </CardFrameHeader>
    {profile === null ? (
      <EmptyBindingCard
        message="No provisioning profile bound."
        actionLabel="Set provisioning profile"
        onChange={onChange}
      />
    ) : (
      <Table variant="card">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Apple Team</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead className="w-12" aria-label="Actions" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <ProfileRow profile={profile} team={team} onChange={onChange} onRemove={onRemove} />
        </TableBody>
      </Table>
    )}
  </CardFrame>
);

const ProfileRow = ({
  profile,
  team,
  onChange,
  onRemove,
}: {
  profile: AppleProvisioningProfileItem;
  team: AppleTeamItem | null;
  onChange: () => void;
  onRemove: () => void;
}) => {
  const profileStatus = deriveExpiryStatus(profile.validUntil);
  return (
    <TableRow>
      <TableCell className="font-medium">
        {profile.profileName ?? profile.developerPortalIdentifier ?? "Unnamed profile"}
      </TableCell>
      <TableCell>{team ? formatAppleTeamLabel(team) : profile.appleTeamId}</TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <span>{profile.validUntil === null ? "—" : formatDate(profile.validUntil)}</span>
          <Badge variant={STATUS_BADGE_VARIANT[profileStatus.tone]}>{profileStatus.label}</Badge>
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">{formatDate(profile.updatedAt)}</TableCell>
      <TableCell className="text-right">
        <RowKebab
          ariaLabel="Provisioning profile actions"
          onChange={onChange}
          onRemove={onRemove}
        />
      </TableCell>
    </TableRow>
  );
};

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
  orgId,
  projectId,
  config,
  certs,
  profiles,
  teams,
}: {
  orgId: string;
  projectId: string;
  config: IosBundleConfigurationItem;
  certs: readonly AppleDistributionCertificateItem[];
  profiles: readonly AppleProvisioningProfileItem[];
  teams: readonly AppleTeamItem[];
}) => {
  const queryClient = useQueryClient();
  const [certDialogOpen, setCertDialogOpen] = useState(false);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [deleteConfigOpen, setDeleteConfigOpen] = useState(false);

  const cert = findCert(certs, config.appleDistributionCertificateId);
  const profile = findProfile(profiles, config.appleProvisioningProfileId);
  const team = findTeam(teams, config.appleTeamId);

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: iosBundleConfigurationsQueryOptions(orgId, projectId).queryKey,
    });
  };

  const removeCertMutation = useApiMutation({
    mutationFn: async () =>
      updateIosBundleConfiguration(config.id, { appleDistributionCertificateId: null }),
    onSuccess: async () => {
      toastManager.add({ title: "Distribution certificate unbound", type: "success" });
      await invalidate();
    },
  });

  const removeProfileMutation = useApiMutation({
    mutationFn: async () =>
      updateIosBundleConfiguration(config.id, { appleProvisioningProfileId: null }),
    onSuccess: async () => {
      toastManager.add({ title: "Provisioning profile unbound", type: "success" });
      await invalidate();
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          Team: <span className="text-foreground">{team ? formatAppleTeamLabel(team) : "—"}</span>
        </p>
        <Menu>
          <MenuTrigger
            render={<Button variant="ghost" size="icon" aria-label="Distribution-type actions" />}
          >
            <EllipsisVerticalIcon strokeWidth={2} />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuGroup>
              <MenuItem
                variant="destructive"
                onClick={() => {
                  setDeleteConfigOpen(true);
                }}
              >
                <Trash2Icon strokeWidth={2} />
                <span>Delete {DISTRIBUTION_LABELS[config.distributionType]} configuration</span>
              </MenuItem>
            </MenuGroup>
          </MenuPopup>
        </Menu>
      </div>

      <CertTableCard
        cert={cert}
        team={team}
        onChange={() => {
          setCertDialogOpen(true);
        }}
        onRemove={() => {
          removeCertMutation.mutate();
        }}
      />

      <ProfileTableCard
        profile={profile}
        team={team}
        onChange={() => {
          setProfileDialogOpen(true);
        }}
        onRemove={() => {
          removeProfileMutation.mutate();
        }}
      />

      <IosChangeCertDialog
        open={certDialogOpen}
        onOpenChange={setCertDialogOpen}
        orgId={orgId}
        projectId={projectId}
        bundleConfigId={config.id}
        appleTeamId={config.appleTeamId}
        currentCert={cert}
      />
      <IosChangeProfileDialog
        open={profileDialogOpen}
        onOpenChange={setProfileDialogOpen}
        orgId={orgId}
        projectId={projectId}
        bundleConfigId={config.id}
        bundleIdentifier={config.bundleIdentifier}
        distributionType={config.distributionType}
        appleTeamId={config.appleTeamId}
        currentProfile={profile}
      />
      <ConfirmDeleteDialog
        name={DISTRIBUTION_LABELS[config.distributionType]}
        title={`Delete ${DISTRIBUTION_LABELS[config.distributionType]} configuration?`}
        description="Removes this distribution-type configuration. Other distribution types for this bundle remain intact."
        onConfirm={async () => deleteIosBundleConfiguration(config.id)}
        successMessage="Distribution-type configuration deleted"
        onSuccess={invalidate}
        open={deleteConfigOpen}
        onOpenChange={setDeleteConfigOpen}
      />
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
                orgId={orgId}
                projectId={projectId}
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
