import {
  androidApplicationIdentifiersQueryOptions,
  androidBuildCredentialsQueryOptions,
  googleServiceAccountKeysQueryOptions,
} from "@better-update/api-client/react";
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
import { useSuspenseQuery } from "@tanstack/react-query";

import type { GoogleServiceAccountKeyItem } from "@better-update/api-client/react";

import { formatDate } from "../../../../../lib/format-date";
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
  <CardFrame>
    <CardFrameHeader className="py-4">
      <CardFrameTitle className="text-base">{title}</CardFrameTitle>
    </CardFrameHeader>
    {sa === null ? (
      <Card>
        <CardPanel className="py-4">
          <span className="text-muted-foreground text-sm">{emptyLabel}</span>
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
