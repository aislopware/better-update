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
import { Alert, AlertTitle } from "@better-update/ui/components/ui/alert";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { TriangleAlertIcon } from "lucide-react";
import { Suspense, useMemo } from "react";

import { PageHeader, SectionHeader } from "../../../components/page-header";
import { SectionSkeleton, TableSkeleton } from "../../../components/skeletons";
import { assertCapability, isOrgAdmin } from "../../../lib/access";
import { deriveExpiryStatus } from "../../../lib/credential-status";
import { ClientPaginationFooter, useClientPagination } from "../../../lib/data-table";
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

  return message === null ? null : (
    <Alert variant="warning">
      <TriangleAlertIcon />
      <AlertTitle>{message}</AlertTitle>
    </Alert>
  );
};

const DistributionCertificatesSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(appleDistributionCertificatesQueryOptions(orgId));
  const { teamsById, canManageProtection } = useAppleChildSection(orgId);
  const pagination = useClientPagination(data.items, "certificate");

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Distribution Certificates"
        description=".p12 certs for signing iOS builds."
      />
      {data.items.length === 0 ? (
        <DistributionCertificatesEmptyState />
      ) : (
        <>
          <div className="overflow-hidden rounded-md border">
            <DistributionCertificatesTable
              items={pagination.pageItems}
              orgId={orgId}
              teamsById={teamsById}
              canManageProtection={canManageProtection}
            />
          </div>
          <ClientPaginationFooter state={pagination} />
        </>
      )}
    </section>
  );
};

const PushKeysSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(applePushKeysQueryOptions(orgId));
  const { teamsById, canManageProtection } = useAppleChildSection(orgId);
  const pagination = useClientPagination(data.items, "key");

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="APNs Push Keys"
        description=".p8 keys for Apple Push Notification service."
      />
      {data.items.length === 0 ? (
        <PushKeysEmptyState />
      ) : (
        <>
          <div className="overflow-hidden rounded-md border">
            <PushKeysTable
              items={pagination.pageItems}
              orgId={orgId}
              teamsById={teamsById}
              canManageProtection={canManageProtection}
            />
          </div>
          <ClientPaginationFooter state={pagination} />
        </>
      )}
    </section>
  );
};

const PushCertificatesSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(applePushCertificatesQueryOptions(orgId));
  const { teamsById, canManageProtection } = useAppleChildSection(orgId);
  const pagination = useClientPagination(data.items, "certificate");

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Push Certificates"
        description="APNs Push Services SSL certificates (.p12)."
      />
      {data.items.length === 0 ? (
        <PushCertificatesEmptyState />
      ) : (
        <>
          <div className="overflow-hidden rounded-md border">
            <PushCertificatesTable
              items={pagination.pageItems}
              orgId={orgId}
              teamsById={teamsById}
              canManageProtection={canManageProtection}
            />
          </div>
          <ClientPaginationFooter state={pagination} />
        </>
      )}
    </section>
  );
};

const PayCertificatesSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(applePayCertificatesQueryOptions(orgId));
  const { teamsById, canManageProtection } = useAppleChildSection(orgId);
  const pagination = useClientPagination(data.items, "certificate");

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Apple Pay Certificates"
        description="Apple Pay payment processing certificates (.p12)."
      />
      {data.items.length === 0 ? (
        <PayCertificatesEmptyState />
      ) : (
        <>
          <div className="overflow-hidden rounded-md border">
            <PayCertificatesTable
              items={pagination.pageItems}
              orgId={orgId}
              teamsById={teamsById}
              canManageProtection={canManageProtection}
            />
          </div>
          <ClientPaginationFooter state={pagination} />
        </>
      )}
    </section>
  );
};

const PassTypeCertificatesSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(applePassTypeCertificatesQueryOptions(orgId));
  const { teamsById, canManageProtection } = useAppleChildSection(orgId);
  const pagination = useClientPagination(data.items, "certificate");

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Pass Type ID Certificates"
        description="Wallet Pass Type ID certificates (.p12)."
      />
      {data.items.length === 0 ? (
        <PassTypeCertificatesEmptyState />
      ) : (
        <>
          <div className="overflow-hidden rounded-md border">
            <PassTypeCertificatesTable
              items={pagination.pageItems}
              orgId={orgId}
              teamsById={teamsById}
              canManageProtection={canManageProtection}
            />
          </div>
          <ClientPaginationFooter state={pagination} />
        </>
      )}
    </section>
  );
};

const AscApiKeysSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(ascApiKeysQueryOptions(orgId));
  // Binding management is org-admin work (GITLAB-RBAC-SPEC §1a) — same gate
  // as the protection toggles. Team-scoped keys inherit their team's bindings.
  const { teamsById, canManageProtection } = useAppleChildSection(orgId);

  const pagination = useClientPagination(data.items, "key");

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="App Store Connect API Keys" description=".p8 keys for the ASC API." />
      {data.items.length === 0 ? (
        <AscApiKeysEmptyState />
      ) : (
        <>
          <div className="overflow-hidden rounded-md border">
            <AscApiKeysTable
              items={pagination.pageItems}
              teamsById={teamsById}
              orgId={orgId}
              canManageBindings={canManageProtection}
              canManageProtection={canManageProtection}
            />
          </div>
          <ClientPaginationFooter state={pagination} />
        </>
      )}
    </section>
  );
};

const AppleTeamsSection = ({ orgId }: { orgId: string }) => {
  const { data: teams } = useSuspenseQuery(appleTeamsQueryOptions(orgId));
  // Protection toggles are admin/owner-only (GITLAB-RBAC-SPEC §3b) — everyone
  // else sees the read-only protected state.
  const { data: me } = useSuspenseQuery(meQueryOptions());
  const pagination = useClientPagination(teams.items, "team");

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Apple Teams"
        description="Teams are auto-derived from uploaded certificates, push keys, and ASC API keys. Protected teams restrict creating credentials under the team to Maintainers; new credentials start with the team's protected state."
      />
      {teams.items.length === 0 ? (
        <AppleTeamsEmptyState />
      ) : (
        <>
          <div className="overflow-hidden rounded-md border">
            <AppleTeamsTable
              items={pagination.pageItems}
              orgId={orgId}
              canManageProtection={isOrgAdmin(me.orgRole)}
            />
          </div>
          <ClientPaginationFooter state={pagination} />
        </>
      )}
    </section>
  );
};

const GoogleServiceAccountSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(googleServiceAccountKeysQueryOptions(orgId));
  const { data: me } = useSuspenseQuery(meQueryOptions());
  const pagination = useClientPagination(data.items, "key");

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Google Service Account Keys"
        description=".json keys for FCM v1 push notifications. Protected keys are restricted to Maintainers."
      />
      {data.items.length === 0 ? (
        <GoogleServiceAccountKeysEmptyState />
      ) : (
        <>
          <div className="overflow-hidden rounded-md border">
            <GoogleServiceAccountKeysTable
              items={pagination.pageItems}
              orgId={orgId}
              canManageProtection={isOrgAdmin(me.orgRole)}
            />
          </div>
          <ClientPaginationFooter state={pagination} />
        </>
      )}
    </section>
  );
};

const CredentialSectionSkeleton = () => (
  <SectionSkeleton hasAction={false}>
    <TableSkeleton columns={4} rows={2} hasFooter={false} />
  </SectionSkeleton>
);

const Credentials = () => {
  const { activeOrg } = Route.useRouteContext();
  const orgId = activeOrg.id;
  return (
    <div className="flex w-full flex-col gap-8">
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
