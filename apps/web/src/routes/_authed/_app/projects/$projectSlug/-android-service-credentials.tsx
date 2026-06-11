import {
  androidApplicationIdentifiersQueryOptions,
  androidBuildCredentialsQueryOptions,
  googleServiceAccountKeysQueryOptions,
} from "@better-update/api-client/react";
import { Frame, FrameHeader, FramePanel, FrameTitle } from "@better-update/ui/components/ui/frame";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { useSuspenseQuery } from "@tanstack/react-query";

import type { GoogleServiceAccountKeyItem } from "@better-update/api-client/react";

import { CopyButton, CopyableMono } from "../../../../../lib/copy-button";
import { formatShortDateTime } from "../../../../../lib/format-date";
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
  sa,
}: {
  title: string;
  emptyLabel: string;
  sa: GoogleServiceAccountKeyItem | null;
}) => (
  <Frame>
    <FrameHeader>
      <FrameTitle>{title}</FrameTitle>
    </FrameHeader>
    {sa === null ? (
      <FramePanel className="py-4">
        <span className="text-muted-foreground text-sm">{emptyLabel}</span>
      </FramePanel>
    ) : (
      <Table variant="card">
        <TableHeader>
          <TableRow>
            <TableHead>Project ID</TableHead>
            <TableHead>Private Key ID</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Uploaded at</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>
              <CopyableMono value={sa.googleProjectId} label="Project ID" />
            </TableCell>
            <TableCell>
              <span className="flex items-center gap-1">
                <span className="font-mono text-xs">{truncatePrivateKey(sa.privateKeyId)}</span>
                <CopyButton value={sa.privateKeyId} label="Private key ID" />
              </span>
            </TableCell>
            <TableCell>
              <div className="flex flex-col gap-0.5">
                <CopyableMono value={sa.clientEmail} label="Client email" />
                {sa.clientId === null ? null : (
                  <span className="text-muted-foreground text-xs">ID: {sa.clientId}</span>
                )}
              </div>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formatShortDateTime(sa.createdAt)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )}
  </Frame>
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
  const { data: identifiersResult } = useSuspenseQuery(
    androidApplicationIdentifiersQueryOptions(orgId, projectId),
  );
  const identifier = identifiersResult.items.find((item) => item.packageName === packageName);

  const { data: groupsResult } = useSuspenseQuery(
    androidBuildCredentialsQueryOptions(orgId, identifier === undefined ? "" : identifier.id),
  );
  const { data: gsaResult } = useSuspenseQuery(googleServiceAccountKeysQueryOptions(orgId));

  if (identifier === undefined) {
    return null;
  }

  const sortedGroups = sortGroupsByDefault(groupsResult.items);
  const [defaultGroup] = sortedGroups;

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
        emptyLabel="No service account key configured for FCM v1 push notifications — bind one with the CLI."
        sa={fcmSa}
      />
    </section>
  );
};
