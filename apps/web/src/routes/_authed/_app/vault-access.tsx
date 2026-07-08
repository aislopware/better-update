import {
  accountKeysQueryOptions,
  encryptionKeysQueryOptions,
  envVaultWrapsQueryOptions,
  orgRobotAccountsQueryOptions,
  orgVaultQueryOptions,
  vaultRecipientsQueryOptions,
} from "@better-update/api-client/react";
import { Alert, AlertDescription, AlertTitle } from "@better-update/ui/components/ui/alert";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Card } from "@better-update/ui/components/ui/card";
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
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { FingerprintIcon, TriangleAlertIcon } from "lucide-react";
import { Suspense } from "react";

import { PageHeader } from "../../../components/page-header";
import { TableSkeleton } from "../../../components/skeletons";
import { assertCapability } from "../../../lib/access";
import { CopyableMono } from "../../../lib/copy-button";
import { pluralize } from "../../../lib/pluralize";
import { RelativeTime } from "../../../lib/relative-time";
import { membersQueryOptions } from "../../../queries/org";
import { VaultAccessGrant } from "./-vault-access-grant";
import {
  buildRecipientOwners,
  ENCRYPTION_KEY_KIND_META,
  joinEnvVaultRecipients,
  joinVaultRecipients,
} from "./-vault-access-utils";

import type { RecipientOwners, VaultRecipientRow } from "./-vault-access-utils";

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

const OwnerCell = ({ owner }: { owner: VaultRecipientRow["owner"] }) =>
  owner ? (
    <div className="flex flex-col">
      <span>{owner.name}</span>
      {owner.detail ? <span className="text-muted-foreground text-xs">{owner.detail}</span> : null}
    </div>
  ) : (
    <span className="text-muted-foreground">—</span>
  );

const RecipientsTable = ({ rows }: { rows: readonly VaultRecipientRow[] }) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Recipient</TableHead>
        <TableHead>Owner</TableHead>
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
          <TableRow key={row.recipientId}>
            <TableCell className="font-medium">{row.label}</TableCell>
            <TableCell>
              <OwnerCell owner={row.owner} />
            </TableCell>
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
  <Alert className="text-warning *:data-[slot=alert-description]:text-warning/90">
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

const EnvRotationPendingBanner = () => (
  <Alert className="text-warning *:data-[slot=alert-description]:text-warning/90">
    <TriangleAlertIcon />
    <AlertTitle>Env rotation required</AlertTitle>
    <AlertDescription>
      An env-vault recipient was removed, so the env vault must be rotated before env values can be
      read again. Run{" "}
      <code className="font-mono text-xs">better-update credentials env-vault rotate</code> from the
      CLI.
    </AlertDescription>
  </Alert>
);

/**
 * Recipients of the SEPARATE env-vault key (post-cutover): the same key kinds as
 * the credentials vault plus the members' browser account keys. Rendered only
 * once the org has cut over — before that env values are sealed under the
 * credentials vault and the section would be noise.
 */
/** Section heading: the vault name as a title with its key version alongside as a badge. */
const VaultSectionHeading = ({
  title,
  version,
  summary,
}: {
  title: string;
  version: number;
  summary: string;
}) => (
  <div className="flex items-center gap-2">
    <h2 className="text-sm font-medium">{title}</h2>
    <Badge variant="outline">v{version}</Badge>
    <span className="text-muted-foreground text-sm">{summary}</span>
  </div>
);

const EnvVaultRecipientsSection = ({
  orgId,
  envVaultVersion,
  rotationPending,
  owners,
}: {
  orgId: string;
  envVaultVersion: number;
  rotationPending: boolean;
  owners: RecipientOwners;
}) => {
  const { data: wraps } = useSuspenseQuery(envVaultWrapsQueryOptions(orgId));
  const { data: keys } = useSuspenseQuery(encryptionKeysQueryOptions(orgId));
  const { data: accounts } = useSuspenseQuery(accountKeysQueryOptions(orgId));
  const rows = joinEnvVaultRecipients(wraps.recipients, keys.items, accounts.items, owners);

  return (
    <section className="flex flex-col gap-3">
      {rotationPending ? <EnvRotationPendingBanner /> : null}
      <VaultSectionHeading
        title="Env vault"
        version={envVaultVersion}
        summary={`${rows.length} ${pluralize(rows.length, "recipient")} can decrypt this organization's env values`}
      />
      {rows.length > 0 ? (
        <div className="overflow-hidden rounded-md border">
          <RecipientsTable rows={rows} />
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">No env-vault recipients yet.</p>
      )}
    </section>
  );
};

const VaultAccessContent = () => {
  const { activeOrg } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const { data: vault } = useSuspenseQuery(vaultRecipientsQueryOptions(orgId));
  const { data: orgVault } = useSuspenseQuery(orgVaultQueryOptions(orgId));
  const { data: keys } = useSuspenseQuery(encryptionKeysQueryOptions(orgId));
  const { data: members } = useSuspenseQuery(membersQueryOptions(orgId));
  // Robots resolve machine-key owners; a caller who may not list them still gets
  // the page — those rows just show no owner.
  const { data: robots } = useQuery(orgRobotAccountsQueryOptions(orgId));
  const owners = buildRecipientOwners(members, robots ?? []);
  const rows = joinVaultRecipients(vault.recipients, keys.items, owners);

  if (rows.length === 0) {
    return <VaultAccessEmptyState />;
  }

  return (
    <>
      <section className="flex flex-col gap-3">
        {orgVault?.rotationPending ? (
          <RotationPendingBanner reason={orgVault.rotationPendingReason} />
        ) : null}
        <VaultSectionHeading
          title="Credentials vault"
          version={vault.vaultVersion}
          summary={`${rows.length} ${pluralize(rows.length, "recipient")} can decrypt this organization's credentials`}
        />
        <div className="overflow-hidden rounded-md border">
          <RecipientsTable rows={rows} />
        </div>
      </section>
      {orgVault !== null && orgVault.envVaultCutoverAt !== null ? (
        <EnvVaultRecipientsSection
          orgId={orgId}
          envVaultVersion={orgVault.envVaultVersion}
          rotationPending={orgVault.envRotationPending}
          owners={owners}
        />
      ) : null}
    </>
  );
};

const VaultAccess = () => {
  const { activeOrg } = Route.useRouteContext();
  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title="Vault access"
        description="Recipients that can decrypt this organization's credentials and env vaults (managed from the CLI). Env-vault access can be granted from the browser on the vault origin."
      />
      <Suspense fallback={<TableSkeleton columns={6} rows={3} hasFooter={false} />}>
        <VaultAccessContent />
      </Suspense>
      <VaultAccessGrant orgId={activeOrg.id} />
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/vault-access")({
  beforeLoad: async ({ context }) => {
    await assertCapability(context.queryClient, "canViewVaultAccess");
  },
  component: VaultAccess,
});
