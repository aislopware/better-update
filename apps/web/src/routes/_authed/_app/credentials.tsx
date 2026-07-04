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
import { Frame } from "@better-update/ui/components/ui/frame";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useMemo } from "react";

import { PageHeader, SectionHeader } from "../../../components/page-header";
import { SectionSkeleton, TableSkeleton } from "../../../components/skeletons";
import { assertCapability, isOrgAdmin } from "../../../lib/access";
import {
  AppleTeamsEmptyState,
  AppleTeamsTable,
  AscApiKeysEmptyState,
  AscApiKeysTable,
  DistributionCertificatesEmptyState,
  DistributionCertificatesTable,
  PassTypeCertificatesEmptyState,
  PassTypeCertificatesTable,
  PayCertificatesEmptyState,
  PayCertificatesTable,
  PushCertificatesEmptyState,
  PushCertificatesTable,
  PushKeysEmptyState,
  PushKeysTable,
} from "./-credentials-tables";
import {
  GoogleServiceAccountKeysEmptyState,
  GoogleServiceAccountKeysTable,
} from "./-credentials-tables-google";
import { indexAppleTeamsById } from "./-credentials-utils";

const DistributionCertificatesSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(appleDistributionCertificatesQueryOptions(orgId));
  const { data: teams } = useSuspenseQuery(appleTeamsQueryOptions(orgId));
  const teamsById = useMemo(() => indexAppleTeamsById(teams.items), [teams.items]);

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Distribution Certificates"
        description=".p12 certs for signing iOS builds."
      />
      {data.items.length === 0 ? (
        <DistributionCertificatesEmptyState />
      ) : (
        <Frame>
          <DistributionCertificatesTable items={data.items} teamsById={teamsById} />
        </Frame>
      )}
    </section>
  );
};

const PushKeysSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(applePushKeysQueryOptions(orgId));
  const { data: teams } = useSuspenseQuery(appleTeamsQueryOptions(orgId));
  const teamsById = useMemo(() => indexAppleTeamsById(teams.items), [teams.items]);

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="APNs Push Keys"
        description=".p8 keys for Apple Push Notification service."
      />
      {data.items.length === 0 ? (
        <PushKeysEmptyState />
      ) : (
        <Frame>
          <PushKeysTable items={data.items} teamsById={teamsById} />
        </Frame>
      )}
    </section>
  );
};

const PushCertificatesSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(applePushCertificatesQueryOptions(orgId));

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Push Certificates"
        description="APNs Push Services SSL certificates (.p12)."
      />
      {data.items.length === 0 ? (
        <PushCertificatesEmptyState />
      ) : (
        <Frame>
          <PushCertificatesTable items={data.items} />
        </Frame>
      )}
    </section>
  );
};

const PayCertificatesSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(applePayCertificatesQueryOptions(orgId));

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Apple Pay Certificates"
        description="Apple Pay payment processing certificates (.p12)."
      />
      {data.items.length === 0 ? (
        <PayCertificatesEmptyState />
      ) : (
        <Frame>
          <PayCertificatesTable items={data.items} />
        </Frame>
      )}
    </section>
  );
};

const PassTypeCertificatesSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(applePassTypeCertificatesQueryOptions(orgId));

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Pass Type ID Certificates"
        description="Wallet Pass Type ID certificates (.p12)."
      />
      {data.items.length === 0 ? (
        <PassTypeCertificatesEmptyState />
      ) : (
        <Frame>
          <PassTypeCertificatesTable items={data.items} />
        </Frame>
      )}
    </section>
  );
};

const AscApiKeysSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(ascApiKeysQueryOptions(orgId));
  const { data: teams } = useSuspenseQuery(appleTeamsQueryOptions(orgId));
  const teamsById = useMemo(() => indexAppleTeamsById(teams.items), [teams.items]);
  // Binding management is org-admin work (GITLAB-RBAC-SPEC §1a) — same gate
  // as the protection toggles. Team-scoped keys inherit their team's bindings.
  const { data: me } = useSuspenseQuery(meQueryOptions());

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="App Store Connect API Keys" description=".p8 keys for the ASC API." />
      {data.items.length === 0 ? (
        <AscApiKeysEmptyState />
      ) : (
        <Frame>
          <AscApiKeysTable
            items={data.items}
            teamsById={teamsById}
            orgId={orgId}
            canManageBindings={isOrgAdmin(me.orgRole)}
          />
        </Frame>
      )}
    </section>
  );
};

const AppleTeamsSection = ({ orgId }: { orgId: string }) => {
  const { data: teams } = useSuspenseQuery(appleTeamsQueryOptions(orgId));
  // Protection toggles are admin/owner-only (GITLAB-RBAC-SPEC §3b) — everyone
  // else sees the read-only protected state.
  const { data: me } = useSuspenseQuery(meQueryOptions());

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Apple Teams"
        description="Teams are auto-derived from uploaded certificates, push keys, and ASC API keys. Protected teams restrict every credential in the team to Maintainers."
      />
      {teams.items.length === 0 ? (
        <AppleTeamsEmptyState />
      ) : (
        <Frame>
          <AppleTeamsTable
            items={teams.items}
            orgId={orgId}
            canManageProtection={isOrgAdmin(me.orgRole)}
          />
        </Frame>
      )}
    </section>
  );
};

const GoogleServiceAccountSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(googleServiceAccountKeysQueryOptions(orgId));
  const { data: me } = useSuspenseQuery(meQueryOptions());

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Google Service Account Keys"
        description=".json keys for FCM v1 push notifications. Protected keys are restricted to Maintainers."
      />
      {data.items.length === 0 ? (
        <GoogleServiceAccountKeysEmptyState />
      ) : (
        <Frame>
          <GoogleServiceAccountKeysTable
            items={data.items}
            orgId={orgId}
            canManageProtection={isOrgAdmin(me.orgRole)}
          />
        </Frame>
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
