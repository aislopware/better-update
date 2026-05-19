import {
  androidApplicationIdentifiersQueryOptions,
  androidBuildCredentialsQueryOptions,
  androidUploadKeystoresQueryOptions,
  deleteAndroidBuildCredentials,
  updateAndroidBuildCredentials,
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
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
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
import { CheckCircle2Icon, EllipsisVerticalIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import type {
  AndroidBuildCredentialsItem,
  AndroidUploadKeystoreItem,
} from "@better-update/api-client/react";

import { formatDate } from "../../../../../lib/format-date";
import { useApiMutation } from "../../../../../lib/use-api-mutation";
import { AddAndroidCredentialGroupDialog } from "./-add-android-credential-group-dialog";
import { AndroidChangeKeystoreDialog } from "./-android-change-keystore-dialog";
import { findKeystore, sortGroupsByDefault } from "./-android-detail-shared";
import { ConfirmDeleteDialog } from "./-confirm-delete-dialog";

const formatFingerprint = (value: string | null): string => {
  if (value === null) {
    return "—";
  }
  if (value.length <= 12) {
    return value;
  }
  return `${value.slice(0, 5)}…${value.slice(-4)}`;
};

const KeystoreCard = ({
  keystore,
  onChange,
  onRemove,
}: {
  keystore: AndroidUploadKeystoreItem | null;
  onChange: () => void;
  onRemove: () => void;
}) => (
  <CardFrame>
    <CardFrameHeader className="py-4">
      <CardFrameTitle className="text-base">Android upload keystore</CardFrameTitle>
    </CardFrameHeader>
    {keystore === null ? (
      <Card>
        <CardPanel className="flex items-center justify-between gap-3 py-4">
          <span className="text-muted-foreground text-sm">No upload keystore bound.</span>
          <Button size="sm" variant="outline" onClick={onChange}>
            Set upload keystore
          </Button>
        </CardPanel>
      </Card>
    ) : (
      <Table variant="card">
        <TableHeader>
          <TableRow>
            <TableHead>Key alias</TableHead>
            <TableHead>SHA-1 Fingerprint</TableHead>
            <TableHead>SHA-256 Fingerprint</TableHead>
            <TableHead>Uploaded at</TableHead>
            <TableHead className="w-12" aria-label="Actions" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="font-medium">{keystore.keyAlias}</TableCell>
            <TableCell className="font-mono text-xs">
              {formatFingerprint(keystore.sha1Fingerprint)}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {formatFingerprint(keystore.sha256Fingerprint)}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formatDate(keystore.updatedAt)}
            </TableCell>
            <TableCell className="text-right">
              <Menu>
                <MenuTrigger
                  render={<Button variant="ghost" size="icon" aria-label="Keystore actions" />}
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

const GroupOptionLabel = ({ group }: { group: AndroidBuildCredentialsItem }) => (
  <span className="flex items-center gap-2 truncate">
    <span className="truncate">{group.name}</span>
    {group.isDefault ? (
      <Badge variant="success" className="gap-1">
        <CheckCircle2Icon strokeWidth={2} className="size-3" />
        Default
      </Badge>
    ) : null}
  </span>
);

const GroupSwitcher = ({
  groups,
  selectedId,
  onChange,
  group,
  onSetDefault,
  onDelete,
  setDefaultPending,
}: {
  groups: readonly AndroidBuildCredentialsItem[];
  selectedId: string;
  onChange: (id: string) => void;
  group: AndroidBuildCredentialsItem;
  onSetDefault: () => void;
  onDelete: () => void;
  setDefaultPending: boolean;
}) => (
  <div className="flex items-center gap-2">
    <Select
      value={selectedId}
      onValueChange={(next) => {
        if (next !== null) {
          onChange(next);
        }
      }}
    >
      <SelectTrigger className="min-w-64 flex-1">
        <SelectValue>{() => <GroupOptionLabel group={group} />}</SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {groups.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            <GroupOptionLabel group={item} />
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
    <Menu>
      <MenuTrigger
        render={<Button variant="ghost" size="icon" aria-label="Credential group actions" />}
      >
        <EllipsisVerticalIcon strokeWidth={2} />
      </MenuTrigger>
      <MenuPopup align="end">
        {group.isDefault ? null : (
          <>
            <MenuGroup>
              <MenuItem disabled={setDefaultPending} onClick={onSetDefault}>
                <CheckCircle2Icon strokeWidth={2} />
                <span>Set as default</span>
              </MenuItem>
            </MenuGroup>
            <MenuSeparator />
          </>
        )}
        <MenuGroup>
          <MenuItem variant="destructive" onClick={onDelete}>
            <Trash2Icon strokeWidth={2} />
            <span>Delete credential group</span>
          </MenuItem>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  </div>
);

const EmptyGroups = ({
  orgId,
  applicationIdentifierId,
}: {
  orgId: string;
  applicationIdentifierId: string;
}) => (
  <Card>
    <CardPanel className="flex flex-col items-start gap-3 py-6">
      <p className="text-muted-foreground text-sm">
        No credential groups yet. Add a group to bind an upload keystore and service account keys.
      </p>
      <AddAndroidCredentialGroupDialog
        orgId={orgId}
        applicationIdentifierId={applicationIdentifierId}
      />
    </CardPanel>
  </Card>
);

const useSelectedGroup = (
  groups: readonly AndroidBuildCredentialsItem[],
): [string, (id: string) => void, AndroidBuildCredentialsItem | undefined] => {
  const [firstGroup] = groups;
  const [selectedId, setSelectedId] = useState(firstGroup === undefined ? "" : firstGroup.id);

  const fallbackId = firstGroup === undefined ? "" : firstGroup.id;
  const effectiveId = groups.some((item) => item.id === selectedId) ? selectedId : fallbackId;
  const group = groups.find((item) => item.id === effectiveId);

  return [effectiveId, setSelectedId, group];
};

export const AndroidBuildCredentialsSection = ({
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
  const { data: keystoresResult } = useSuspenseQuery(androidUploadKeystoresQueryOptions(orgId));

  const groups = sortGroupsByDefault(groupsResult.items);
  const [selectedId, setSelectedId, group] = useSelectedGroup(groups);

  const [keystoreDialogOpen, setKeystoreDialogOpen] = useState(false);
  const [deleteGroupOpen, setDeleteGroupOpen] = useState(false);

  const invalidate = async () => {
    if (identifier === undefined) {
      return;
    }
    await queryClient.invalidateQueries({
      queryKey: androidBuildCredentialsQueryOptions(orgId, identifier.id).queryKey,
    });
  };

  const removeKeystoreMutation = useApiMutation({
    mutationFn: async () => {
      if (group === undefined) {
        return;
      }
      await updateAndroidBuildCredentials(group.id, { androidUploadKeystoreId: null });
    },
    onSuccess: async () => {
      toastManager.add({ title: "Upload keystore unbound", type: "success" });
      await invalidate();
    },
  });

  const setDefaultMutation = useApiMutation({
    mutationFn: async () => {
      if (group === undefined) {
        return;
      }
      await updateAndroidBuildCredentials(group.id, { isDefault: true });
    },
    onSuccess: async () => {
      if (group !== undefined) {
        toastManager.add({ title: `Default group set to "${group.name}"`, type: "success" });
      }
      await invalidate();
    },
  });

  if (identifier === undefined) {
    return null;
  }

  const keystore =
    group === undefined ? null : findKeystore(keystoresResult.items, group.androidUploadKeystoreId);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-base leading-none font-semibold">Build credentials</h2>
          <p className="text-muted-foreground text-sm">
            Select saved credentials below or create a new one. The CLI picks a group by build
            profile name.
          </p>
        </div>
        {groups.length > 0 ? (
          <AddAndroidCredentialGroupDialog orgId={orgId} applicationIdentifierId={identifier.id} />
        ) : null}
      </div>
      {group === undefined ? (
        <EmptyGroups orgId={orgId} applicationIdentifierId={identifier.id} />
      ) : (
        <>
          <GroupSwitcher
            groups={groups}
            selectedId={selectedId}
            onChange={setSelectedId}
            group={group}
            onSetDefault={() => {
              setDefaultMutation.mutate();
            }}
            onDelete={() => {
              setDeleteGroupOpen(true);
            }}
            setDefaultPending={setDefaultMutation.isPending}
          />
          <KeystoreCard
            keystore={keystore}
            onChange={() => {
              setKeystoreDialogOpen(true);
            }}
            onRemove={() => {
              removeKeystoreMutation.mutate();
            }}
          />
          <AndroidChangeKeystoreDialog
            open={keystoreDialogOpen}
            onOpenChange={setKeystoreDialogOpen}
            orgId={orgId}
            applicationIdentifierId={identifier.id}
            buildCredentialsId={group.id}
            currentKeystore={keystore}
          />
          <ConfirmDeleteDialog
            name={group.name}
            title={`Delete credential group "${group.name}"?`}
            description="Removes this credential group. Org-level keystores and service account keys are not deleted."
            onConfirm={async () => deleteAndroidBuildCredentials(group.id)}
            successMessage="Credential group deleted"
            onSuccess={invalidate}
            open={deleteGroupOpen}
            onOpenChange={setDeleteGroupOpen}
          />
        </>
      )}
    </section>
  );
};
