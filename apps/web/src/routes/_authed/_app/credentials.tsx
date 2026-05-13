import {
  appleDistributionCertificatesQueryOptions,
  applePushKeysQueryOptions,
  appleTeamsQueryOptions,
  ascApiKeysQueryOptions,
  deleteAppleDistributionCertificate,
  deleteApplePushKey,
  deleteAscApiKey,
  deleteGoogleServiceAccountKey,
  googleServiceAccountKeysQueryOptions,
  syncDevicesViaAscApiKey,
} from "@better-update/api-client/react";
import { CardFrame } from "@better-update/ui/components/ui/card";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";

import { PageHeader, SectionHeader } from "../../../components/page-header";
import { SectionSkeleton, TableSkeleton } from "../../../components/skeletons";
import { useApiMutation } from "../../../lib/use-api-mutation";
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
import { UploadAscApiKeyDialog } from "./-upload-asc-api-key-dialog";
import { UploadDistributionCertificateDialog } from "./-upload-distribution-certificate-dialog";
import { UploadGoogleServiceAccountKeyDialog } from "./-upload-google-sa-key-dialog";
import { UploadPushKeyDialog } from "./-upload-push-key-dialog";

const DistributionCertificatesSection = ({ orgId }: { orgId: string }) => {
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery(appleDistributionCertificatesQueryOptions(orgId));
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: appleDistributionCertificatesQueryOptions(orgId).queryKey,
      }),
      queryClient.invalidateQueries({ queryKey: appleTeamsQueryOptions(orgId).queryKey }),
    ]);
  };

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Distribution Certificates"
        description=".p12 certs for signing iOS builds."
        actions={<UploadDistributionCertificateDialog orgId={orgId} />}
      />
      {data.items.length === 0 ? (
        <DistributionCertificatesEmptyState />
      ) : (
        <CardFrame>
          <DistributionCertificatesTable
            items={data.items}
            onDelete={deleteAppleDistributionCertificate}
            onInvalidate={invalidate}
          />
        </CardFrame>
      )}
    </section>
  );
};

const PushKeysSection = ({ orgId }: { orgId: string }) => {
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery(applePushKeysQueryOptions(orgId));
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: applePushKeysQueryOptions(orgId).queryKey }),
      queryClient.invalidateQueries({ queryKey: appleTeamsQueryOptions(orgId).queryKey }),
    ]);
  };

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="APNs Push Keys"
        description=".p8 keys for Apple Push Notification service."
        actions={<UploadPushKeyDialog orgId={orgId} />}
      />
      {data.items.length === 0 ? (
        <PushKeysEmptyState />
      ) : (
        <CardFrame>
          <PushKeysTable
            items={data.items}
            onDelete={deleteApplePushKey}
            onInvalidate={invalidate}
          />
        </CardFrame>
      )}
    </section>
  );
};

const AscApiKeysSection = ({ orgId }: { orgId: string }) => {
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery(ascApiKeysQueryOptions(orgId));

  const syncMutation = useApiMutation({
    mutationFn: syncDevicesViaAscApiKey,
    onSuccess: async (result) => {
      toastManager.add({
        title: `Synced ${String(result.pulled)} pulled, ${String(result.pushed)} pushed, ${String(result.skipped)} skipped`,
        type: "success",
      });
      await queryClient.invalidateQueries({ queryKey: ["org", orgId, "devices"] });
    },
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ascApiKeysQueryOptions(orgId).queryKey }),
      queryClient.invalidateQueries({ queryKey: appleTeamsQueryOptions(orgId).queryKey }),
    ]);
  };

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="App Store Connect API Keys"
        description=".p8 keys for the ASC API."
        actions={<UploadAscApiKeyDialog orgId={orgId} />}
      />
      {data.items.length === 0 ? (
        <AscApiKeysEmptyState />
      ) : (
        <CardFrame>
          <AscApiKeysTable
            items={data.items}
            onDelete={deleteAscApiKey}
            onInvalidate={invalidate}
            onSync={(id) => {
              syncMutation.mutate(id);
            }}
            syncPending={syncMutation.isPending}
          />
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
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery(googleServiceAccountKeysQueryOptions(orgId));
  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: googleServiceAccountKeysQueryOptions(orgId).queryKey,
    });
  };

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Google Service Account Keys"
        description=".json keys for FCM v1 and Play Store submissions."
        actions={<UploadGoogleServiceAccountKeyDialog orgId={orgId} />}
      />
      {data.items.length === 0 ? (
        <GoogleServiceAccountKeysEmptyState />
      ) : (
        <CardFrame>
          <GoogleServiceAccountKeysTable
            items={data.items}
            onDelete={deleteGoogleServiceAccountKey}
            onInvalidate={invalidate}
          />
        </CardFrame>
      )}
    </section>
  );
};

const CredentialSectionSkeleton = ({ hasAction = true }: { hasAction?: boolean }) => (
  <SectionSkeleton hasAction={hasAction}>
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
      <Suspense fallback={<CredentialSectionSkeleton hasAction={false} />}>
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
