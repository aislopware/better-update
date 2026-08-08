import {
  appleDistributionCertificatesQueryOptions,
  applePassTypeCertificatesQueryOptions,
  applePayCertificatesQueryOptions,
  applePushCertificatesQueryOptions,
  applePushKeysQueryOptions,
  appleTeamsQueryOptions,
  ascApiKeysQueryOptions,
  googleServiceAccountKeysQueryOptions,
  meQueryOptions,
} from "@better-update/api-client/react";
import { Banner } from "@better-update/ui/components/banner";
import { WarningIcon } from "@phosphor-icons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useMemo } from "react";

import type { ReactNode } from "react";

import { PageHeader } from "../../../components/page-header";
import { TablePanelSkeleton } from "../../../components/skeletons";
import { TablePanel } from "../../../components/table-panel";
import { assertCapability, isOrgAdmin } from "../../../lib/access";
import { deriveExpiryStatus } from "../../../lib/credential-status";
import { useClientPagination } from "../../../lib/data-table";
import { pluralize } from "../../../lib/pluralize";
import {
  AppleTeamsEmptyState,
  AppleTeamsTable,
  AscApiKeysEmptyState,
  AscApiKeysTable,
  DistributionCertificatesEmptyState,
  DistributionCertificatesTable,
  PushKeysEmptyState,
  PushKeysTable,
} from "./-credentials-tables";
import {
  PassTypeCertificatesEmptyState,
  PassTypeCertificatesTable,
  PayCertificatesEmptyState,
  PayCertificatesTable,
  PushCertificatesEmptyState,
  PushCertificatesTable,
} from "./-credentials-tables-certs";
import {
  GoogleServiceAccountKeysEmptyState,
  GoogleServiceAccountKeysTable,
} from "./-credentials-tables-google";
import { indexAppleTeamsById } from "./-credentials-utils";

// Every Apple child section shares the same shape: the list itself, the teams
// map (team labels) and the org-admin gate for the per-row protection
// switches (GITLAB-RBAC-SPEC §3b).
const useAppleChildSection = (orgId: string) => {
  const { data: teams } = useSuspenseQuery(appleTeamsQueryOptions(orgId));
  const teamsById = useMemo(() => indexAppleTeamsById(teams.items), [teams.items]);
  const { data: me } = useSuspenseQuery(meQueryOptions());
  return { teamsById, canManageProtection: isOrgAdmin(me.orgRole) };
};

/**
 * Rollup message across every expiring credential type, from tones the tables
 * already derive per row (lib/credential-status). Null when nothing is at risk.
 */
const expiryRollupMessage = (
  items: readonly { readonly validUntil: string | null }[],
  now: Date = new Date(),
): string | null => {
  const tones = items.map((item) => deriveExpiryStatus(item.validUntil, now).tone);
  const expired = tones.filter((tone) => tone === "error").length;
  const expiringSoon = tones.filter((tone) => tone === "warning").length;
  const parts = [
    expired > 0
      ? `${expired} ${pluralize(expired, "certificate")} ${expired === 1 ? "has" : "have"} expired`
      : null,
    expiringSoon > 0
      ? `${expiringSoon} ${pluralize(expiringSoon, "certificate")} ${expiringSoon === 1 ? "expires" : "expire"} within 30 days`
      : null,
  ].filter((part) => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
};

// Slim attention banner above the sections. Reads the same queries the cert
// sections below suspend on (react-query dedupes), so no extra data is loaded.
const ExpiryRollupBanner = ({ orgId }: { orgId: string }) => {
  const { data: distribution } = useSuspenseQuery(appleDistributionCertificatesQueryOptions(orgId));
  const { data: push } = useSuspenseQuery(applePushCertificatesQueryOptions(orgId));
  const { data: pay } = useSuspenseQuery(applePayCertificatesQueryOptions(orgId));
  const { data: passType } = useSuspenseQuery(applePassTypeCertificatesQueryOptions(orgId));
  const message = expiryRollupMessage([
    ...distribution.items,
    ...push.items,
    ...pay.items,
    ...passType.items,
  ]);

  // A warning that names no remedy leaves the reader to go looking for one; the
  // devices banner names its command, so this one names its own.
  return message === null ? null : (
    <Banner
      variant="alert"
      icon={<WarningIcon weight="fill" />}
      title={message}
      description={
        <>
          Builds signed with an expired certificate are rejected. Upload a replacement with{" "}
          <code className="bg-kumo-recessed rounded px-1 py-0.5 font-mono text-xs">
            better-update credentials upload
          </code>{" "}
          from the CLI.
        </>
      }
    />
  );
};

interface CredentialPanelProps<T> {
  readonly title: string;
  readonly description: string;
  readonly items: readonly T[];
  /** Singular noun for the count line — "certificate", "key", "team". */
  readonly noun: string;
  readonly empty: ReactNode;
  readonly children: (pageItems: readonly T[]) => ReactNode;
}

/**
 * One credential type, drawn as one panel. Every section on this page differs
 * only in its query and its table, so the frame, the paging and the empty line
 * are settled once here rather than eight times below.
 */
const CredentialPanel = <T,>({
  title,
  description,
  items,
  noun,
  empty,
  children,
}: CredentialPanelProps<T>) => {
  const pagination = useClientPagination(items, noun);
  return (
    <TablePanel
      title={title}
      description={description}
      pagination={items.length === 0 ? undefined : pagination}
    >
      {items.length === 0 ? empty : children(pagination.pageItems)}
    </TablePanel>
  );
};

const DistributionCertificatesSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(appleDistributionCertificatesQueryOptions(orgId));
  const { teamsById, canManageProtection } = useAppleChildSection(orgId);

  return (
    <CredentialPanel
      title="Distribution Certificates"
      description=".p12 certs for signing iOS builds."
      items={data.items}
      noun="certificate"
      empty={<DistributionCertificatesEmptyState />}
    >
      {(pageItems) => (
        <DistributionCertificatesTable
          items={pageItems}
          orgId={orgId}
          teamsById={teamsById}
          canManageProtection={canManageProtection}
        />
      )}
    </CredentialPanel>
  );
};

const PushKeysSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(applePushKeysQueryOptions(orgId));
  const { teamsById, canManageProtection } = useAppleChildSection(orgId);

  return (
    <CredentialPanel
      title="APNs Push Keys"
      description=".p8 keys for Apple Push Notification service."
      items={data.items}
      noun="key"
      empty={<PushKeysEmptyState />}
    >
      {(pageItems) => (
        <PushKeysTable
          items={pageItems}
          orgId={orgId}
          teamsById={teamsById}
          canManageProtection={canManageProtection}
        />
      )}
    </CredentialPanel>
  );
};

const PushCertificatesSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(applePushCertificatesQueryOptions(orgId));
  const { teamsById, canManageProtection } = useAppleChildSection(orgId);

  return (
    <CredentialPanel
      title="Push Certificates"
      description="APNs Push Services SSL certificates (.p12)."
      items={data.items}
      noun="certificate"
      empty={<PushCertificatesEmptyState />}
    >
      {(pageItems) => (
        <PushCertificatesTable
          items={pageItems}
          orgId={orgId}
          teamsById={teamsById}
          canManageProtection={canManageProtection}
        />
      )}
    </CredentialPanel>
  );
};

const PayCertificatesSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(applePayCertificatesQueryOptions(orgId));
  const { teamsById, canManageProtection } = useAppleChildSection(orgId);

  return (
    <CredentialPanel
      title="Apple Pay Certificates"
      description="Apple Pay payment processing certificates (.p12)."
      items={data.items}
      noun="certificate"
      empty={<PayCertificatesEmptyState />}
    >
      {(pageItems) => (
        <PayCertificatesTable
          items={pageItems}
          orgId={orgId}
          teamsById={teamsById}
          canManageProtection={canManageProtection}
        />
      )}
    </CredentialPanel>
  );
};

const PassTypeCertificatesSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(applePassTypeCertificatesQueryOptions(orgId));
  const { teamsById, canManageProtection } = useAppleChildSection(orgId);

  return (
    <CredentialPanel
      title="Pass Type ID Certificates"
      description="Wallet Pass Type ID certificates (.p12)."
      items={data.items}
      noun="certificate"
      empty={<PassTypeCertificatesEmptyState />}
    >
      {(pageItems) => (
        <PassTypeCertificatesTable
          items={pageItems}
          orgId={orgId}
          teamsById={teamsById}
          canManageProtection={canManageProtection}
        />
      )}
    </CredentialPanel>
  );
};

const AscApiKeysSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(ascApiKeysQueryOptions(orgId));
  // Binding management is org-admin work (GITLAB-RBAC-SPEC §1a) — same gate
  // as the protection toggles. Team-scoped keys inherit their team's bindings.
  const { teamsById, canManageProtection } = useAppleChildSection(orgId);

  return (
    <CredentialPanel
      title="App Store Connect API Keys"
      description=".p8 keys for the ASC API."
      items={data.items}
      noun="key"
      empty={<AscApiKeysEmptyState />}
    >
      {(pageItems) => (
        <AscApiKeysTable
          items={pageItems}
          teamsById={teamsById}
          orgId={orgId}
          canManageBindings={canManageProtection}
          canManageProtection={canManageProtection}
        />
      )}
    </CredentialPanel>
  );
};

const AppleTeamsSection = ({ orgId }: { orgId: string }) => {
  const { data: teams } = useSuspenseQuery(appleTeamsQueryOptions(orgId));
  // Protection toggles are admin/owner-only (GITLAB-RBAC-SPEC §3b) — everyone
  // else sees the read-only protected state.
  const { data: me } = useSuspenseQuery(meQueryOptions());

  return (
    <CredentialPanel
      title="Apple Teams"
      description="Teams are auto-derived from uploaded certificates, push keys, and ASC API keys. Protected teams restrict creating credentials under the team to Maintainers; new credentials start with the team's protected state."
      items={teams.items}
      noun="team"
      empty={<AppleTeamsEmptyState />}
    >
      {(pageItems) => (
        <AppleTeamsTable
          items={pageItems}
          orgId={orgId}
          canManageProtection={isOrgAdmin(me.orgRole)}
        />
      )}
    </CredentialPanel>
  );
};

const GoogleServiceAccountSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(googleServiceAccountKeysQueryOptions(orgId));
  const { data: me } = useSuspenseQuery(meQueryOptions());

  return (
    <CredentialPanel
      title="Google Service Account Keys"
      description=".json keys for FCM v1 push notifications. Protected keys are restricted to Maintainers."
      items={data.items}
      noun="key"
      empty={<GoogleServiceAccountKeysEmptyState />}
    >
      {(pageItems) => (
        <GoogleServiceAccountKeysTable
          items={pageItems}
          orgId={orgId}
          canManageProtection={isOrgAdmin(me.orgRole)}
        />
      )}
    </CredentialPanel>
  );
};

const CredentialSectionSkeleton = () => <TablePanelSkeleton rows={2} columns={4} />;

const Credentials = () => {
  const { activeOrg } = Route.useRouteContext();
  const orgId = activeOrg.id;
  return (
    // Panels carry their own frame, so they stack at card spacing rather than at
    // the wider step loose sections needed to read as separate.
    <div className="flex w-full flex-col gap-4">
      <PageHeader
        title="Credentials"
        description="Apple and Google credentials shared across all projects in this organization."
      />
      <Suspense fallback={null}>
        <ExpiryRollupBanner orgId={orgId} />
      </Suspense>
      <Suspense fallback={<CredentialSectionSkeleton />}>
        <DistributionCertificatesSection orgId={orgId} />
      </Suspense>
      <Suspense fallback={<CredentialSectionSkeleton />}>
        <PushKeysSection orgId={orgId} />
      </Suspense>
      <Suspense fallback={<CredentialSectionSkeleton />}>
        <PushCertificatesSection orgId={orgId} />
      </Suspense>
      <Suspense fallback={<CredentialSectionSkeleton />}>
        <PayCertificatesSection orgId={orgId} />
      </Suspense>
      <Suspense fallback={<CredentialSectionSkeleton />}>
        <PassTypeCertificatesSection orgId={orgId} />
      </Suspense>
      <Suspense fallback={<CredentialSectionSkeleton />}>
        <AscApiKeysSection orgId={orgId} />
      </Suspense>
      <Suspense fallback={<CredentialSectionSkeleton />}>
        <AppleTeamsSection orgId={orgId} />
      </Suspense>
      <Suspense fallback={<CredentialSectionSkeleton />}>
        <GoogleServiceAccountSection orgId={orgId} />
      </Suspense>
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/credentials")({
  beforeLoad: async ({ context }) => {
    await assertCapability(context.queryClient, "canViewCredentials");
  },
  component: Credentials,
});
