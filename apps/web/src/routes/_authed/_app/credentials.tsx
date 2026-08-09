import {
  androidUploadKeystoresQueryOptions,
  googleServiceAccountKeysQueryOptions,
  meQueryOptions,
} from "@better-update/api-client/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";

import { PageHeader } from "../../../components/page-header";
import { TablePanelSkeleton } from "../../../components/skeletons";
import { assertCapability, isOrgAdmin } from "../../../lib/access";
import { CredentialPanel } from "./-credential-panel";
import {
  AppleTeamsSection,
  AscApiKeysSection,
  DistributionCertificatesSection,
  ExpiryRollupBanner,
  PassTypeCertificatesSection,
  PayCertificatesSection,
  PushCertificatesSection,
  PushKeysSection,
  UnusedCertificateTypesPanel,
} from "./-credentials-sections-apple";
import {
  ANDROID_UPLOAD_KEYSTORES_EMPTY_HINT,
  AndroidUploadKeystoresTable,
} from "./-credentials-tables-android";
import {
  GOOGLE_SERVICE_ACCOUNT_KEYS_EMPTY_HINT,
  GoogleServiceAccountKeysTable,
} from "./-credentials-tables-google";

const GoogleServiceAccountSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(googleServiceAccountKeysQueryOptions(orgId));
  const { data: me } = useSuspenseQuery(meQueryOptions());

  return (
    <CredentialPanel
      title="Google Service Account Keys"
      description=".json keys for FCM v1 push notifications. Protected keys are restricted to Maintainers."
      items={data.items}
      noun="key"
      emptyHint={GOOGLE_SERVICE_ACCOUNT_KEYS_EMPTY_HINT}
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

// Org-scoped like the Google keys beside it, and the only place an upload
// keystore is listed whole: the project pages show one keystore each, the one
// bound to the build credential group being read, so a keystore uploaded but
// not yet bound to anything appears nowhere else on the web.
const AndroidUploadKeystoresSection = ({ orgId }: { orgId: string }) => {
  const { data } = useSuspenseQuery(androidUploadKeystoresQueryOptions(orgId));
  const { data: me } = useSuspenseQuery(meQueryOptions());

  return (
    <CredentialPanel
      title="Android Upload Keystores"
      description="Keystores for signing Android builds. Protected keystores are restricted to Maintainers."
      items={data.items}
      noun="keystore"
      emptyHint={ANDROID_UPLOAD_KEYSTORES_EMPTY_HINT}
    >
      {(pageItems) => (
        <AndroidUploadKeystoresTable
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
        description="Apple, Google and Android signing credentials shared across all projects in this organization."
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
      <Suspense fallback={null}>
        <UnusedCertificateTypesPanel orgId={orgId} />
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
      <Suspense fallback={<CredentialSectionSkeleton />}>
        <AndroidUploadKeystoresSection orgId={orgId} />
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
