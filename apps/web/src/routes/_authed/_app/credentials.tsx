import {
  appleDistributionCertificatesQueryOptions,
  applePushKeysQueryOptions,
  appleTeamsQueryOptions,
  ascApiKeysQueryOptions,
  googleServiceAccountKeysQueryOptions,
} from "@better-update/api-client/react";
import { CardFrame } from "@better-update/ui/components/ui/card";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useMemo } from "react";

import { PageHeader, SectionHeader } from "../../../components/page-header";
import { SectionSkeleton, TableSkeleton } from "../../../components/skeletons";
import {
  AppleTeamsEmptyState,
  AppleTeamsTable,
  AscApiKeysEmptyState,
  AscApiKeysTable,
  DistributionCertificatesEmptyState,
  DistributionCertificatesTable,
  GoogleServiceAccountKeysEmptyState,
  GoogleServiceAccountKeysTable,
  PushKeysEmptyState,
  PushKeysTable,
} from "./-credentials-tables";
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
        <CardFrame>
          <DistributionCertificatesTable items={data.items} teamsById={teamsById} />
        </CardFrame>
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
        <CardFrame>
          <PushKeysTable items={data.items} teamsById={teamsById} />
        </CardFrame>
      )}
    </section>
  );
};

const AscApiKeysSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(ascApiKeysQueryOptions(orgId));
  const { data: teams } = useSuspenseQuery(appleTeamsQueryOptions(orgId));
  const teamsById = useMemo(() => indexAppleTeamsById(teams.items), [teams.items]);

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="App Store Connect API Keys" description=".p8 keys for the ASC API." />
      {data.items.length === 0 ? (
        <AscApiKeysEmptyState />
      ) : (
        <CardFrame>
          <AscApiKeysTable items={data.items} teamsById={teamsById} />
        </CardFrame>
      )}
    </section>
  );
};

const AppleTeamsSection = ({ orgId }: { orgId: string }) => {
  const { data: teams } = useSuspenseQuery(appleTeamsQueryOptions(orgId));

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Apple Teams"
        description="Teams are auto-derived from uploaded certificates, push keys, and ASC API keys."
      />
      {teams.items.length === 0 ? (
        <AppleTeamsEmptyState />
      ) : (
        <CardFrame>
          <AppleTeamsTable items={teams.items} />
        </CardFrame>
      )}
    </section>
  );
};

const GoogleServiceAccountSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(googleServiceAccountKeysQueryOptions(orgId));

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Google Service Account Keys"
        description=".json keys for FCM v1 push notifications."
      />
      {data.items.length === 0 ? (
        <GoogleServiceAccountKeysEmptyState />
      ) : (
        <CardFrame>
          <GoogleServiceAccountKeysTable items={data.items} />
        </CardFrame>
      )}
    </section>
  );
};

const CredentialSectionSkeleton = () => (
  <SectionSkeleton hasAction={false}>
    <TableSkeleton variant="card" columns={4} rows={2} hasFooter={false} />
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
  component: Credentials,
});
