import {
  androidApplicationIdentifiersQueryOptions,
  androidBuildCredentialsQueryOptions,
  androidUploadKeystoresQueryKey,
  androidUploadKeystoresQueryOptions,
  meQueryOptions,
  setAndroidUploadKeystoreProtection,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Card } from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { Field, FieldLabel } from "@better-update/ui/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { toast } from "@better-update/ui/components/ui/sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { CheckCircle2Icon, KeyRoundIcon } from "lucide-react";
import { useState } from "react";

import type {
  AndroidBuildCredentialsItem,
  AndroidUploadKeystoreItem,
} from "@better-update/api-client/react";

import { BoundProjectsCell } from "../../-credential-bindings";
import { ProtectionCell } from "../../-credential-cells";
import { CliCommandBlock } from "../../../../../components/cli-command-block";
import { isOrgAdmin } from "../../../../../lib/access";
import { CopyButton } from "../../../../../lib/copy-button";
import { formatShortDateTime } from "../../../../../lib/format-date";
import { useApiMutation } from "../../../../../lib/use-api-mutation";
import { findKeystore, sortGroupsByDefault } from "./-android-detail-shared";
import { CredentialSection, EmptyBindingMessage } from "./-credential-section";

const formatFingerprint = (value: string): string => {
  if (value.length <= 12) {
    return value;
  }
  return `${value.slice(0, 5)}…${value.slice(-4)}`;
};

const FingerprintCell = ({ value, label }: { value: string | null; label: string }) =>
  value === null ? (
    <span className="font-mono text-xs">—</span>
  ) : (
    <span className="flex items-center gap-1">
      <span className="font-mono text-xs">{formatFingerprint(value)}</span>
      <CopyButton value={value} label={label} />
    </span>
  );

// Per-row protection toggle (GITLAB-RBAC-SPEC §3b): protected keystores are
// restricted to Maintainers; only org admins/owners may flip the switch.
const KeystoreProtectionSwitch = ({
  orgId,
  keystore,
}: {
  orgId: string;
  keystore: AndroidUploadKeystoreItem;
}) => {
  const queryClient = useQueryClient();
  const { data: me } = useSuspenseQuery(meQueryOptions());
  const protectionMutation = useApiMutation({
    mutationFn: async (next: boolean) => setAndroidUploadKeystoreProtection(keystore.id, next),
    onSuccess: async (_result, next) => {
      toast.success(next ? "Keystore protected" : "Keystore unprotected");
      await queryClient.invalidateQueries({ queryKey: androidUploadKeystoresQueryKey(orgId) });
    },
  });
  return (
    <ProtectionCell
      label={`Protect ${keystore.keyAlias}`}
      checked={keystore.protected}
      canManage={isOrgAdmin(me.orgRole)}
      isPending={protectionMutation.isPending}
      onToggle={(next) => {
        protectionMutation.mutate(next);
      }}
    />
  );
};

// Per-row binding chips + admin-only manage dialog (GITLAB-RBAC-SPEC §1a):
// upload keystores bind to projects individually, same gate as protection.
const KeystoreBindingsCell = ({
  orgId,
  keystore,
}: {
  orgId: string;
  keystore: AndroidUploadKeystoreItem;
}) => {
  const { data: me } = useSuspenseQuery(meQueryOptions());
  return (
    <BoundProjectsCell
      orgId={orgId}
      resourceType="androidUploadKeystore"
      resourceId={keystore.id}
      resourceLabel={`the ${keystore.keyAlias} keystore`}
      boundProjectIds={keystore.boundProjectIds}
      boundToAllProjects={keystore.boundToAllProjects}
      canManage={isOrgAdmin(me.orgRole)}
    />
  );
};

const KeystoreCard = ({
  orgId,
  keystore,
}: {
  orgId: string;
  keystore: AndroidUploadKeystoreItem | null;
}) => (
  <CredentialSection title="Android upload keystore">
    {keystore === null ? (
      <EmptyBindingMessage message="No upload keystore bound — bind one with the CLI." />
    ) : (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Key alias</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>SHA-1 Fingerprint</TableHead>
            <TableHead>SHA-256 Fingerprint</TableHead>
            <TableHead>Protected</TableHead>
            <TableHead>Projects</TableHead>
            <TableHead>Uploaded at</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="font-medium">{keystore.keyAlias}</TableCell>
            <TableCell>
              {keystore.keystoreType === null ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <Badge variant="secondary">{keystore.keystoreType}</Badge>
              )}
            </TableCell>
            <TableCell>
              <FingerprintCell value={keystore.sha1Fingerprint} label="SHA-1" />
            </TableCell>
            <TableCell>
              <FingerprintCell value={keystore.sha256Fingerprint} label="SHA-256" />
            </TableCell>
            <TableCell>
              <KeystoreProtectionSwitch orgId={orgId} keystore={keystore} />
            </TableCell>
            <TableCell>
              <KeystoreBindingsCell orgId={orgId} keystore={keystore} />
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formatShortDateTime(keystore.updatedAt)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )}
  </CredentialSection>
);

const GroupOptionLabel = ({ group }: { group: AndroidBuildCredentialsItem }) => (
  <span className="flex items-center gap-2 truncate">
    <span className="truncate">{group.name}</span>
    {group.isDefault ? (
      <Badge variant="success">
        <CheckCircle2Icon strokeWidth={2} data-icon="inline-start" />
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
}: {
  groups: readonly AndroidBuildCredentialsItem[];
  selectedId: string;
  onChange: (id: string) => void;
  group: AndroidBuildCredentialsItem;
}) => (
  <Field>
    <FieldLabel>Credential group</FieldLabel>
    <Select
      value={selectedId}
      onValueChange={(next) => {
        if (next !== null) {
          onChange(next);
        }
      }}
    >
      <SelectTrigger className="min-w-64">
        <SelectValue>{() => <GroupOptionLabel group={group} />}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {groups.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            <GroupOptionLabel group={item} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </Field>
);

const EmptyGroups = () => (
  <Card>
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <KeyRoundIcon strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>No credential groups yet</EmptyTitle>
        <EmptyDescription>
          Add a group from the CLI to bind an upload keystore and service account keys for this
          identifier.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <CliCommandBlock commands={["better-update credentials configure --platform android"]} />
      </EmptyContent>
    </Empty>
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

  if (identifier === undefined) {
    return null;
  }

  const keystore =
    group === undefined ? null : findKeystore(keystoresResult.items, group.androidUploadKeystoreId);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-base leading-none font-semibold">Build credentials</h2>
        <p className="text-muted-foreground text-sm">
          Saved credential groups for this application identifier. The CLI picks a group by build
          profile name.
        </p>
      </div>
      {group === undefined ? (
        <EmptyGroups />
      ) : (
        <>
          <GroupSwitcher
            groups={groups}
            selectedId={selectedId}
            onChange={setSelectedId}
            group={group}
          />
          <KeystoreCard orgId={orgId} keystore={keystore} />
        </>
      )}
    </section>
  );
};
