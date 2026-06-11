import {
  encryptionKeysQueryOptions,
  orgVaultQueryOptions,
  vaultRecipientsQueryOptions,
} from "@better-update/api-client/react";
import { Alert, AlertDescription, AlertTitle } from "@better-update/ui/components/ui/alert";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Card, CardFrame } from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { FingerprintIcon, TriangleAlertIcon } from "lucide-react";
import { Suspense } from "react";

import { PageHeader } from "../../../components/page-header";
import { TableSkeleton } from "../../../components/skeletons";
import { CopyableMono } from "../../../lib/copy-button";
import { pluralize } from "../../../lib/pluralize";
import { RelativeTime } from "../../../lib/relative-time";
import { ENCRYPTION_KEY_KIND_META, joinVaultRecipients } from "./-vault-access-utils";

import type { VaultRecipientRow } from "./-vault-access-utils";

const VaultAccessEmptyState = () => (
  <Card>
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FingerprintIcon strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>No vault recipients yet</EmptyTitle>
        <EmptyDescription>
          The credential vault is created from the CLI on the first upload. Once it exists, the keys
          that can decrypt it appear here.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  </Card>
);

const RecipientsTable = ({ rows }: { rows: readonly VaultRecipientRow[] }) => (
  <Table variant="card">
    <TableHeader>
      <TableRow>
        <TableHead>Recipient</TableHead>
        <TableHead>Type</TableHead>
        <TableHead>Fingerprint</TableHead>
        <TableHead>Granted</TableHead>
        <TableHead>Last used</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {rows.map((row) => {
        const meta = ENCRYPTION_KEY_KIND_META[row.kind];
        return (
          <TableRow key={row.userEncryptionKeyId}>
            <TableCell className="font-medium">{row.label}</TableCell>
            <TableCell>
              <div className="flex items-center gap-1.5">
                <Badge variant={meta.variant}>{meta.label}</Badge>
                {row.revokedAt ? <Badge variant="destructive">Revoked</Badge> : null}
              </div>
            </TableCell>
            <TableCell>
              <CopyableMono value={row.fingerprint} label="Fingerprint" />
            </TableCell>
            <TableCell className="text-muted-foreground">
              <RelativeTime value={row.grantedAt} />
            </TableCell>
            <TableCell className="text-muted-foreground">
              <RelativeTime value={row.lastUsedAt} />
            </TableCell>
          </TableRow>
        );
      })}
    </TableBody>
  </Table>
);

const RotationPendingBanner = ({ reason }: { reason: string | null }) => (
  <Alert variant="warning">
    <TriangleAlertIcon />
    <AlertTitle>Rotation required</AlertTitle>
    <AlertDescription>
      A recipient was removed from this organization{reason ? ` (${reason})` : ""}, so the vault
      must be rotated before credentials can be downloaded again. Run{" "}
      <code className="font-mono text-xs">better-update credentials access rotate</code> from the
      CLI.
    </AlertDescription>
  </Alert>
);

const VaultAccessContent = () => {
  const { activeOrg } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const { data: vault } = useSuspenseQuery(vaultRecipientsQueryOptions(orgId));
  const { data: orgVault } = useSuspenseQuery(orgVaultQueryOptions(orgId));
  const { data: keys } = useSuspenseQuery(encryptionKeysQueryOptions(orgId));
  const rows = joinVaultRecipients(vault.recipients, keys.items);

  if (rows.length === 0) {
    return <VaultAccessEmptyState />;
  }

  return (
    <section className="flex flex-col gap-3">
      {orgVault?.rotationPending ? (
        <RotationPendingBanner reason={orgVault.rotationPendingReason} />
      ) : null}
      <div className="flex items-center gap-2">
        <Badge variant="outline">Vault v{vault.vaultVersion}</Badge>
        <span className="text-muted-foreground text-sm">
          {rows.length} {pluralize(rows.length, "recipient")} can decrypt this organization&apos;s
          credentials
        </span>
      </div>
      <CardFrame>
        <RecipientsTable rows={rows} />
      </CardFrame>
    </section>
  );
};

const VaultAccess = () => (
  <div className="flex w-full flex-col gap-8">
    <PageHeader
      title="Vault access"
      description="Keys that can decrypt this organization's credential vault. Access is granted and revoked from the CLI."
    />
    <Suspense fallback={<TableSkeleton variant="card" columns={5} rows={3} hasFooter={false} />}>
      <VaultAccessContent />
    </Suspense>
  </div>
);

export const Route = createFileRoute("/_authed/_app/vault-access")({
  component: VaultAccess,
});
