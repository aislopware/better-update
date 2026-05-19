import {
  androidApplicationIdentifiersQueryOptions,
  androidBuildCredentialsQueryOptions,
  googleServiceAccountKeysQueryOptions,
  updateAndroidBuildCredentials,
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

import type { GoogleServiceAccountKeyItem } from "@better-update/api-client/react";

import { formatDate } from "../../../../../lib/format-date";
import { useApiMutation } from "../../../../../lib/use-api-mutation";
import { AndroidChangeGsaDialog } from "./-android-change-gsa-dialog";
import { findGsa, sortGroupsByDefault } from "./-android-detail-shared";

const truncatePrivateKey = (value: string): string => {
  if (value.length <= 16) {
    return value;
  }
  return `${value.slice(0, 16)}…`;
};

const GsaTableCard = ({
  title,
  emptyLabel,
  addLabel,
  sa,
  onChange,
  onRemove,
}: {
  title: string;
  emptyLabel: string;
  addLabel: string;
  sa: GoogleServiceAccountKeyItem | null;
  onChange: () => void;
  onRemove: () => void;
}) => (
  <CardFrame>
    <CardFrameHeader className="py-4">
      <CardFrameTitle className="text-base">{title}</CardFrameTitle>
    </CardFrameHeader>
    {sa === null ? (
      <Card>
        <CardPanel className="flex items-center justify-between gap-3 py-4">
          <span className="text-muted-foreground text-sm">{emptyLabel}</span>
          <Button size="sm" variant="outline" onClick={onChange}>
            {addLabel}
          </Button>
        </CardPanel>
      </Card>
    ) : (
      <Table variant="card">
        <TableHeader>
          <TableRow>
            <TableHead>Project ID</TableHead>
            <TableHead>Private Key ID</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Uploaded at</TableHead>
            <TableHead className="w-12" aria-label="Actions" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="font-mono text-xs">{sa.googleProjectId}</TableCell>
            <TableCell className="font-mono text-xs">
              {truncatePrivateKey(sa.privateKeyId)}
            </TableCell>
            <TableCell className="font-mono text-xs break-all">{sa.clientEmail}</TableCell>
            <TableCell className="text-muted-foreground">{formatDate(sa.createdAt)}</TableCell>
            <TableCell className="text-right">
              <Menu>
                <MenuTrigger
                  render={
                    <Button variant="ghost" size="icon" aria-label="Service account actions" />
                  }
                >
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
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )}
  </CardFrame>
);

export const AndroidServiceCredentialsSection = ({
  orgId,
  projectId,
  packageName,
}: {
  orgId: string;
  projectId: string;
  packageName: string;
}) => {
  const queryClient = useQueryClient();
  const { data: identifiersResult } = useSuspenseQuery(
    androidApplicationIdentifiersQueryOptions(orgId, projectId),
  );
  const identifier = identifiersResult.items.find((item) => item.packageName === packageName);

  const { data: groupsResult } = useSuspenseQuery(
    androidBuildCredentialsQueryOptions(orgId, identifier === undefined ? "" : identifier.id),
  );
  const { data: gsaResult } = useSuspenseQuery(googleServiceAccountKeysQueryOptions(orgId));

  const [fcmDialogOpen, setFcmDialogOpen] = useState(false);

  const invalidate = async () => {
    if (identifier === undefined) {
      return;
    }
    await queryClient.invalidateQueries({
      queryKey: androidBuildCredentialsQueryOptions(orgId, identifier.id).queryKey,
    });
  };

  const removeFcmMutation = useApiMutation({
    mutationFn: async () => {
      const groups = groupsResult.items;
      await Promise.all(
        groups.map(async (group) =>
          updateAndroidBuildCredentials(group.id, { googleServiceAccountKeyForFcmV1Id: null }),
        ),
      );
    },
    onSuccess: async () => {
      toastManager.add({ title: "FCM service account unbound", type: "success" });
      await invalidate();
    },
  });

  if (identifier === undefined) {
    return null;
  }

  const sortedGroups = sortGroupsByDefault(groupsResult.items);
  const [defaultGroup] = sortedGroups;
  const groupIds = sortedGroups.map((group) => group.id);

  const fcmSa =
    defaultGroup === undefined
      ? null
      : findGsa(gsaResult.items, defaultGroup.googleServiceAccountKeyForFcmV1Id);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-base leading-none font-semibold">Service credentials</h2>
        <p className="text-muted-foreground text-sm">
          FCM v1 service account for push notifications. Applied across all credential groups for
          this application identifier.
        </p>
      </div>
      <GsaTableCard
        title="FCM V1 service account key"
        emptyLabel="No service account key configured for FCM v1 push notifications."
        addLabel="Add a service account key"
        sa={fcmSa}
        onChange={() => {
          setFcmDialogOpen(true);
        }}
        onRemove={() => {
          removeFcmMutation.mutate();
        }}
      />
      <AndroidChangeGsaDialog
        open={fcmDialogOpen}
        onOpenChange={setFcmDialogOpen}
        orgId={orgId}
        applicationIdentifierId={identifier.id}
        groupIds={groupIds}
        currentSa={fcmSa}
      />
    </section>
  );
};
