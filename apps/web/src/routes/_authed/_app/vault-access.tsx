import {
  accountKeysQueryOptions,
  encryptionKeysQueryOptions,
  envVaultWrapsQueryOptions,
  orgRobotAccountsQueryOptions,
  orgVaultQueryOptions,
  vaultRecipientsQueryOptions,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/badge";
import { Banner } from "@better-update/ui/components/banner";
import { Empty } from "@better-update/ui/components/empty";
import { InlineCode } from "@better-update/ui/components/inline-code";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/table";
import { FingerprintIcon, WarningIcon } from "@phosphor-icons/react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";

import type { ReactNode } from "react";

import { CliCommandBlock } from "../../../components/cli-command-block";
import { PageHeader } from "../../../components/page-header";
import { TablePanelSkeleton } from "../../../components/skeletons";
import { TablePanel } from "../../../components/table-panel";
import { assertCapability } from "../../../lib/access";
import { CopyableMono } from "../../../lib/copy-button";
import { PRIMARY_COLUMN_CLASS, useClientPagination } from "../../../lib/data-table";
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
  <Empty
    icon={<FingerprintIcon className="text-kumo-inactive size-10" />}
    title="No vault recipients yet"
    description="The credential vault is created from the CLI on the first upload. Once it exists, the keys that can decrypt it appear here."
    contents={<CliCommandBlock commands={["better-update credentials upload"]} />}
  />
);

const OwnerCell = ({ owner }: { owner: VaultRecipientRow["owner"] }) =>
  owner ? (
    <div className="flex flex-col">
      <span>{owner.name}</span>
      {owner.detail ? <span className="text-kumo-subtle text-xs">{owner.detail}</span> : null}
    </div>
  ) : (
    <span className="text-kumo-subtle">—</span>
  );

const RecipientsTable = ({ rows }: { rows: readonly VaultRecipientRow[] }) => (
  <Table className="[&_th]:whitespace-nowrap">
    <TableHeader>
      <TableRow>
        <TableHead className={PRIMARY_COLUMN_CLASS}>Recipient</TableHead>
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
            <TableCell className={`${PRIMARY_COLUMN_CLASS} font-medium`}>{row.label}</TableCell>
            <TableCell>
              <OwnerCell owner={row.owner} />
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-1.5">
                <Badge variant={meta.variant}>{meta.label}</Badge>
                {row.revokedAt ? <Badge variant="error">Revoked</Badge> : null}
              </div>
            </TableCell>
            <TableCell>
              <CopyableMono value={row.fingerprint} label="Fingerprint" />
            </TableCell>
            <TableCell className="text-kumo-subtle">
              <RelativeTime value={row.grantedAt} />
            </TableCell>
            <TableCell className="text-kumo-subtle">
              <RelativeTime value={row.lastUsedAt} />
            </TableCell>
          </TableRow>
        );
      })}
    </TableBody>
  </Table>
);

const RotationPendingBanner = ({ reason }: { reason: string | null }) => (
  <Banner
    variant="alert"
    icon={<WarningIcon weight="fill" />}
    title="Rotation required"
    description={
      <>
        A recipient was removed from this organization{reason ? ` (${reason})` : ""}, so the vault
        must be rotated before credentials can be downloaded again. Run{" "}
        <InlineCode>better-update credentials access rotate</InlineCode> from the CLI.
      </>
    }
  />
);

const EnvRotationPendingBanner = () => (
  <Banner
    variant="alert"
    icon={<WarningIcon weight="fill" />}
    title="Env rotation required"
    description={
      <>
        An env-vault recipient was removed, so the env vault must be rotated before env values can
        be read again. Run <InlineCode>better-update credentials env-vault rotate</InlineCode> from
        the CLI.
      </>
    }
  />
);

/**
 * One vault, drawn as one panel: the vault name carries its key version as a
 * badge, the recipients fill the body, and the count closes the bottom. Any
 * rotation warning stands above the panel, where it reads as a state of the
 * vault rather than a row in it.
 *
 * No description under the title — it read "3 recipients can decrypt this
 * organization's credentials", which is the panel's own name plus the number the
 * bar at the foot of it already reports.
 */
const VaultPanel = ({
  title,
  version,
  banner,
  rows,
}: {
  title: string;
  version: number;
  banner?: ReactNode;
  rows: readonly VaultRecipientRow[];
}) => {
  const pagination = useClientPagination(rows, "recipient");
  return (
    <section className="flex flex-col gap-3">
      {banner}
      <TablePanel
        title={
          <span className="flex items-center gap-2">
            {title}
            <Badge variant="outline">v{version}</Badge>
          </span>
        }
        pagination={rows.length === 0 ? undefined : pagination}
      >
        {rows.length === 0 ? (
          <p className="text-kumo-subtle m-0 px-4 py-3 text-sm">No recipients yet.</p>
        ) : (
          <RecipientsTable rows={pagination.pageItems} />
        )}
      </TablePanel>
    </section>
  );
};

/**
 * Recipients of the SEPARATE env-vault key (post-cutover): the same key kinds as
 * the credentials vault plus the members' browser account keys. Rendered only
 * once the org has cut over — before that env values are sealed under the
 * credentials vault and the section would be noise.
 */
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
    <VaultPanel
      title="Env vault"
      version={envVaultVersion}
      banner={rotationPending ? <EnvRotationPendingBanner /> : null}
      rows={rows}
    />
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
      <VaultPanel
        title="Credentials vault"
        version={vault.vaultVersion}
        banner={
          orgVault?.rotationPending ? (
            <RotationPendingBanner reason={orgVault.rotationPendingReason} />
          ) : null
        }
        rows={rows}
      />
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
      {/* One line: the second sentence explained the card at the foot of this
          page, which carries that explanation in its own description. */}
      <PageHeader
        title="Vault access"
        description="Keys that can decrypt this organization's credentials and environment values."
      />
      <Suspense fallback={<TablePanelSkeleton columns={6} rows={3} />}>
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
