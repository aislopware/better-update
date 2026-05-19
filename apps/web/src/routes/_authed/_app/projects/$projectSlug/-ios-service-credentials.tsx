import {
  applePushKeysQueryOptions,
  appleTeamsQueryOptions,
  ascApiKeysQueryOptions,
  iosBundleConfigurationsQueryOptions,
  updateIosBundleConfiguration,
} from "@better-update/api-client/react";
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
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { EllipsisVerticalIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import type {
  ApplePushKeyItem,
  AppleTeamItem,
  AscApiKeyItem,
} from "@better-update/api-client/react";

import { formatAppleTeamLabel } from "../../-credentials-utils";
import { formatDate } from "../../../../../lib/format-date";
import { useApiMutation } from "../../../../../lib/use-api-mutation";
import { IosChangeAscKeyDialog } from "./-ios-change-asc-key-dialog";
import { IosChangePushKeyDialog } from "./-ios-change-push-key-dialog";

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

const PushKeyTableCard = ({
  pushKey,
  team,
  onChange,
  onRemove,
}: {
  pushKey: ApplePushKeyItem | null;
  team: AppleTeamItem | null;
  onChange: () => void;
  onRemove: () => void;
}) => (
  <CardFrame>
    <CardFrameHeader className="py-4">
      <CardFrameTitle className="text-base">Push notifications key</CardFrameTitle>
    </CardFrameHeader>
    {pushKey === null ? (
      <EmptyBindingCard
        message="No push key bound."
        actionLabel="Add a Push Key"
        onChange={onChange}
      />
    ) : (
      <Table variant="card">
        <TableHeader>
          <TableRow>
            <TableHead>Key ID</TableHead>
            <TableHead>Apple Team</TableHead>
            <TableHead>Uploaded at</TableHead>
            <TableHead className="w-12" aria-label="Actions" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="font-mono">{pushKey.keyId}</TableCell>
            <TableCell>{team ? formatAppleTeamLabel(team) : pushKey.appleTeamId}</TableCell>
            <TableCell className="text-muted-foreground">{formatDate(pushKey.createdAt)}</TableCell>
            <TableCell className="text-right">
              <RowKebab ariaLabel="Push key actions" onChange={onChange} onRemove={onRemove} />
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )}
  </CardFrame>
);

const formatAscTeam = (key: AscApiKeyItem, team: AppleTeamItem | null): string => {
  if (team !== null) {
    return formatAppleTeamLabel(team);
  }
  return key.appleTeamId === null ? "—" : key.appleTeamId;
};

const AscKeyTableCard = ({
  ascKey,
  team,
  onChange,
  onRemove,
}: {
  ascKey: AscApiKeyItem | null;
  team: AppleTeamItem | null;
  onChange: () => void;
  onRemove: () => void;
}) => (
  <CardFrame>
    <CardFrameHeader className="py-4">
      <CardFrameTitle className="text-base">App Store Connect API key</CardFrameTitle>
    </CardFrameHeader>
    {ascKey === null ? (
      <EmptyBindingCard
        message="No App Store Connect API key bound."
        actionLabel="Add an App Store Connect API Key"
        onChange={onChange}
      />
    ) : (
      <Table variant="card">
        <TableHeader>
          <TableRow>
            <TableHead>Label</TableHead>
            <TableHead>Key ID</TableHead>
            <TableHead>Issuer ID</TableHead>
            <TableHead>Apple Team</TableHead>
            <TableHead>Uploaded at</TableHead>
            <TableHead className="w-12" aria-label="Actions" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="font-medium">{ascKey.name}</TableCell>
            <TableCell className="font-mono">{ascKey.keyId}</TableCell>
            <TableCell className="font-mono text-xs break-all">{ascKey.issuerId}</TableCell>
            <TableCell>{formatAscTeam(ascKey, team)}</TableCell>
            <TableCell className="text-muted-foreground">{formatDate(ascKey.createdAt)}</TableCell>
            <TableCell className="text-right">
              <RowKebab ariaLabel="ASC API key actions" onChange={onChange} onRemove={onRemove} />
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )}
  </CardFrame>
);

const findPushKey = (
  items: readonly ApplePushKeyItem[],
  id: string | null,
): ApplePushKeyItem | null => {
  if (id === null) {
    return null;
  }
  const found = items.find((key) => key.id === id);
  return found === undefined ? null : found;
};

const findAscKey = (items: readonly AscApiKeyItem[], id: string | null): AscApiKeyItem | null => {
  if (id === null) {
    return null;
  }
  const found = items.find((key) => key.id === id);
  return found === undefined ? null : found;
};

const findTeam = (items: readonly AppleTeamItem[], id: string): AppleTeamItem | null => {
  const found = items.find((team) => team.id === id);
  return found === undefined ? null : found;
};

export const IosServiceCredentialsSection = ({
  orgId,
  projectId,
  bundleIdentifier,
}: {
  orgId: string;
  projectId: string;
  bundleIdentifier: string;
}) => {
  const queryClient = useQueryClient();
  const { data: configsResult } = useSuspenseQuery(
    iosBundleConfigurationsQueryOptions(orgId, projectId),
  );
  const { data: pushKeysResult } = useSuspenseQuery(applePushKeysQueryOptions(orgId));
  const { data: ascKeysResult } = useSuspenseQuery(ascApiKeysQueryOptions(orgId));
  const { data: teamsResult } = useSuspenseQuery(appleTeamsQueryOptions(orgId));

  const [pushDialogOpen, setPushDialogOpen] = useState(false);
  const [ascDialogOpen, setAscDialogOpen] = useState(false);

  const configs = configsResult.items.filter(
    (config) => config.bundleIdentifier === bundleIdentifier,
  );
  const [firstConfig] = configs;
  const configIds = configs.map((config) => config.id);
  const appleTeamId = firstConfig === undefined ? "" : firstConfig.appleTeamId;

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: iosBundleConfigurationsQueryOptions(orgId, projectId).queryKey,
    });
  };

  const removePushMutation = useApiMutation({
    mutationFn: async () => {
      await Promise.all(
        configIds.map(async (id) => updateIosBundleConfiguration(id, { applePushKeyId: null })),
      );
    },
    onSuccess: async () => {
      toastManager.add({ title: "Push key unbound", type: "success" });
      await invalidate();
    },
  });

  const removeAscMutation = useApiMutation({
    mutationFn: async () => {
      await Promise.all(
        configIds.map(async (id) => updateIosBundleConfiguration(id, { ascApiKeyId: null })),
      );
    },
    onSuccess: async () => {
      toastManager.add({ title: "ASC API key unbound", type: "success" });
      await invalidate();
    },
  });

  if (firstConfig === undefined) {
    return null;
  }

  const pushKey = findPushKey(pushKeysResult.items, firstConfig.applePushKeyId);
  const ascKey = findAscKey(ascKeysResult.items, firstConfig.ascApiKeyId);
  const team = findTeam(teamsResult.items, appleTeamId);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-base leading-none font-semibold">Service credentials</h2>
        <p className="text-muted-foreground text-sm">
          Push notification key and App Store Connect API key for this bundle identifier.
        </p>
      </div>
      <PushKeyTableCard
        pushKey={pushKey}
        team={team}
        onChange={() => {
          setPushDialogOpen(true);
        }}
        onRemove={() => {
          removePushMutation.mutate();
        }}
      />
      <AscKeyTableCard
        ascKey={ascKey}
        team={team}
        onChange={() => {
          setAscDialogOpen(true);
        }}
        onRemove={() => {
          removeAscMutation.mutate();
        }}
      />
      <IosChangePushKeyDialog
        open={pushDialogOpen}
        onOpenChange={setPushDialogOpen}
        orgId={orgId}
        projectId={projectId}
        configIds={configIds}
        appleTeamId={appleTeamId}
        currentKey={pushKey}
      />
      <IosChangeAscKeyDialog
        open={ascDialogOpen}
        onOpenChange={setAscDialogOpen}
        orgId={orgId}
        projectId={projectId}
        configIds={configIds}
        appleTeamId={appleTeamId}
        currentKey={ascKey}
      />
    </section>
  );
};
