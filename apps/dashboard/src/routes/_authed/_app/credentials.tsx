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
import { Card, CardContent } from "@better-update/ui/components/ui/card";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

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

const SectionHeading = ({
  title,
  description,
}: {
  readonly title: string;
  readonly description: string;
}) => (
  <div className="flex flex-col gap-1">
    <h2 className="text-base leading-none font-semibold">{title}</h2>
    <p className="text-muted-foreground text-sm">{description}</p>
  </div>
);

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
      <div className="flex items-start justify-between gap-4">
        <SectionHeading
          title="Distribution Certificates"
          description=".p12 certs for signing iOS builds."
        />
        <UploadDistributionCertificateDialog orgId={orgId} />
      </div>
      {data.items.length === 0 ? (
        <DistributionCertificatesEmptyState />
      ) : (
        <Card>
          <CardContent>
            <DistributionCertificatesTable
              items={data.items}
              onDelete={deleteAppleDistributionCertificate}
              onInvalidate={invalidate}
            />
          </CardContent>
        </Card>
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
      <div className="flex items-start justify-between gap-4">
        <SectionHeading
          title="APNs Push Keys"
          description=".p8 keys for Apple Push Notification service."
        />
        <UploadPushKeyDialog orgId={orgId} />
      </div>
      {data.items.length === 0 ? (
        <PushKeysEmptyState />
      ) : (
        <Card>
          <CardContent>
            <PushKeysTable
              items={data.items}
              onDelete={deleteApplePushKey}
              onInvalidate={invalidate}
            />
          </CardContent>
        </Card>
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
      toast.success(
        `Synced ${String(result.pulled)} pulled, ${String(result.pushed)} pushed, ${String(result.skipped)} skipped`,
      );
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
      <div className="flex items-start justify-between gap-4">
        <SectionHeading
          title="App Store Connect API Keys"
          description=".p8 keys for the ASC API."
        />
        <UploadAscApiKeyDialog orgId={orgId} />
      </div>
      {data.items.length === 0 ? (
        <AscApiKeysEmptyState />
      ) : (
        <Card>
          <CardContent>
            <AscApiKeysTable
              items={data.items}
              onDelete={deleteAscApiKey}
              onInvalidate={invalidate}
              onSync={(id) => {
                syncMutation.mutate(id);
              }}
              syncPending={syncMutation.isPending}
            />
          </CardContent>
        </Card>
      )}
    </section>
  );
};

const AppleTeamsSection = ({ orgId }: { orgId: string }) => {
  const { data: teams } = useSuspenseQuery(appleTeamsQueryOptions(orgId));

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading
        title="Apple Teams"
        description="Teams are auto-derived from uploaded certificates, push keys, and ASC API keys."
      />
      {teams.items.length === 0 ? (
        <AppleTeamsEmptyState />
      ) : (
        <Card>
          <CardContent>
            <AppleTeamsTable items={teams.items} />
          </CardContent>
        </Card>
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
      <div className="flex items-start justify-between gap-4">
        <SectionHeading
          title="Google Service Account Keys"
          description=".json keys for FCM v1 and Play Store submissions."
        />
        <UploadGoogleServiceAccountKeyDialog orgId={orgId} />
      </div>
      {data.items.length === 0 ? (
        <GoogleServiceAccountKeysEmptyState />
      ) : (
        <Card>
          <CardContent>
            <GoogleServiceAccountKeysTable
              items={data.items}
              onDelete={deleteGoogleServiceAccountKey}
              onInvalidate={invalidate}
            />
          </CardContent>
        </Card>
      )}
    </section>
  );
};

const Credentials = () => {
  const { activeOrg } = Route.useRouteContext();
  const orgId = activeOrg.id;
  return (
    <div className="flex w-full flex-col gap-8">
      <DistributionCertificatesSection orgId={orgId} />
      <PushKeysSection orgId={orgId} />
      <AscApiKeysSection orgId={orgId} />
      <AppleTeamsSection orgId={orgId} />
      <GoogleServiceAccountSection orgId={orgId} />
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/credentials")({
  component: Credentials,
});
