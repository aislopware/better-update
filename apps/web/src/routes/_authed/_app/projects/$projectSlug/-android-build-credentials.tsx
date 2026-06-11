import {
  androidApplicationIdentifiersQueryOptions,
  androidBuildCredentialsQueryOptions,
  androidUploadKeystoresQueryOptions,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Card, CardPanel } from "@better-update/ui/components/ui/card";
import { Frame, FrameHeader, FramePanel, FrameTitle } from "@better-update/ui/components/ui/frame";
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
import { useSuspenseQuery } from "@tanstack/react-query";
import { CheckCircle2Icon } from "lucide-react";
import { useState } from "react";

import type {
  AndroidBuildCredentialsItem,
  AndroidUploadKeystoreItem,
} from "@better-update/api-client/react";

import { CopyButton } from "../../../../../lib/copy-button";
import { formatShortDateTime } from "../../../../../lib/format-date";
import { findKeystore, sortGroupsByDefault } from "./-android-detail-shared";

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

const KeystoreCard = ({ keystore }: { keystore: AndroidUploadKeystoreItem | null }) => (
  <Frame>
    <FrameHeader>
      <FrameTitle>Android upload keystore</FrameTitle>
    </FrameHeader>
    {keystore === null ? (
      <FramePanel className="py-4">
        <span className="text-muted-foreground text-sm">
          No upload keystore bound — bind one with the CLI.
        </span>
      </FramePanel>
    ) : (
      <Table variant="card">
        <TableHeader>
          <TableRow>
            <TableHead>Key alias</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>SHA-1 Fingerprint</TableHead>
            <TableHead>SHA-256 Fingerprint</TableHead>
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
            <TableCell className="text-muted-foreground">
              {formatShortDateTime(keystore.updatedAt)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )}
  </Frame>
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
}: {
  groups: readonly AndroidBuildCredentialsItem[];
  selectedId: string;
  onChange: (id: string) => void;
  group: AndroidBuildCredentialsItem;
}) => (
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
    <SelectPopup>
      {groups.map((item) => (
        <SelectItem key={item.id} value={item.id}>
          <GroupOptionLabel group={item} />
        </SelectItem>
      ))}
    </SelectPopup>
  </Select>
);

const EmptyGroups = () => (
  <Card>
    <CardPanel className="py-6">
      <p className="text-muted-foreground text-sm">
        No credential groups yet. Use the CLI to add a group and bind an upload keystore and service
        account keys.
      </p>
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
          <KeystoreCard keystore={keystore} />
        </>
      )}
    </section>
  );
};
