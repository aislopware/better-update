import {
  androidApplicationIdentifiersQueryOptions,
  iosBundleConfigurationsQueryOptions,
} from "@better-update/api-client/react";
import { Alert, AlertDescription, AlertTitle } from "@better-update/ui/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { Skeleton } from "@better-update/ui/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@better-update/ui/components/ui/tabs";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { InfoIcon, KeyRoundIcon, SmartphoneIcon } from "lucide-react";
import { Suspense } from "react";

import { AndroidBuildWizard } from "./-android-build-wizard";
import { AndroidCredentialGroups } from "./-android-credential-groups";

const CredentialListSkeleton = () => (
  <div className="flex flex-col gap-3">
    {[0, 1].map((index) => (
      <Card key={index}>
        <CardHeader>
          <Skeleton className="h-4 w-48 rounded" />
          <Skeleton className="h-3 w-32 rounded" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-3 w-72 rounded" />
        </CardContent>
      </Card>
    ))}
  </div>
);

const IOS_DISTRIBUTION_TYPES = [
  { value: "APP_STORE", label: "App Store" },
  { value: "AD_HOC", label: "Ad-Hoc" },
  { value: "DEVELOPMENT", label: "Development" },
  { value: "ENTERPRISE", label: "Enterprise" },
] as const;

interface IosBundleConfigItem {
  readonly id: string;
  readonly bundleIdentifier: string;
  readonly distributionType: string;
  readonly appleDistributionCertificateId: string | null;
  readonly appleProvisioningProfileId: string | null;
  readonly applePushKeyId: string | null;
  readonly ascApiKeyId: string | null;
}

const IosBundleConfigCard = ({ config }: { config: IosBundleConfigItem }) => (
  <Card key={config.id}>
    <CardHeader>
      <CardTitle className="font-mono text-sm">{config.bundleIdentifier}</CardTitle>
      <CardDescription>{config.distributionType}</CardDescription>
    </CardHeader>
    <CardContent className="text-muted-foreground text-xs">
      Cert: {config.appleDistributionCertificateId === null ? "—" : "bound"} · Profile:{" "}
      {config.appleProvisioningProfileId === null ? "—" : "bound"} · Push:{" "}
      {config.applePushKeyId === null ? "—" : "bound"} · ASC:{" "}
      {config.ascApiKeyId === null ? "—" : "bound"}
    </CardContent>
  </Card>
);

const IosDistributionTabEmpty = ({ label }: { label: string }) => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <SmartphoneIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>No {label} bundle configurations</EmptyTitle>
      <EmptyDescription>
        Run the CLI to generate {label.toLowerCase()} credentials. The wizard binds a cert, profile,
        push key, and ASC API key in one go.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

const IosSummary = ({ orgId, projectId }: { orgId: string; projectId: string }) => {
  const { data } = useSuspenseQuery(iosBundleConfigurationsQueryOptions(orgId, projectId));
  const items = data.items as readonly IosBundleConfigItem[];
  const counts = Object.fromEntries(
    IOS_DISTRIBUTION_TYPES.map((entry) => [
      entry.value,
      items.filter((config) => config.distributionType === entry.value).length,
    ]),
  );

  return (
    <Tabs defaultValue="APP_STORE">
      <TabsList>
        {IOS_DISTRIBUTION_TYPES.map((entry) => {
          const count = counts[entry.value] ?? 0;
          return (
            <TabsTrigger key={entry.value} value={entry.value}>
              {entry.label}
              {count > 0 ? (
                <span className="text-muted-foreground ml-1.5 text-xs">({count})</span>
              ) : null}
            </TabsTrigger>
          );
        })}
      </TabsList>
      {IOS_DISTRIBUTION_TYPES.map((entry) => {
        const configs = items.filter((config) => config.distributionType === entry.value);
        return (
          <TabsContent key={entry.value} value={entry.value} className="pt-4">
            {configs.length === 0 ? (
              <IosDistributionTabEmpty label={entry.label} />
            ) : (
              <div className="flex flex-col gap-3">
                {configs.map((config) => (
                  <IosBundleConfigCard key={config.id} config={config} />
                ))}
              </div>
            )}
          </TabsContent>
        );
      })}
    </Tabs>
  );
};

const AndroidSummary = ({ orgId, projectId }: { orgId: string; projectId: string }) => {
  const { data } = useSuspenseQuery(androidApplicationIdentifiersQueryOptions(orgId, projectId));
  if (data.items.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <KeyRoundIcon strokeWidth={1.5} />
          </EmptyMedia>
          <EmptyTitle>No Android app identifiers</EmptyTitle>
          <EmptyDescription>
            Create an application identifier to manage upload keystores and Google Service Account
            keys for this project.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {data.items.map((identifier) => (
        <Card key={identifier.id}>
          <CardHeader>
            <CardTitle className="font-mono text-sm">{identifier.packageName}</CardTitle>
            <CardDescription>
              Credential groups bound to this Android application identifier. The CLI selects a
              group by build profile name; falls back to the default if none matches.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense
              fallback={<p className="text-muted-foreground text-xs">Loading credential groups…</p>}
            >
              <AndroidCredentialGroups orgId={orgId} applicationIdentifierId={identifier.id} />
            </Suspense>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

const ProjectCredentials = () => {
  const { activeOrg, project } = Route.useRouteContext();
  return (
    <div className="flex w-full flex-col gap-4">
      <Tabs defaultValue="ios">
        <TabsList>
          <TabsTrigger value="ios">iOS</TabsTrigger>
          <TabsTrigger value="android">Android</TabsTrigger>
        </TabsList>
        <TabsContent value="ios" className="pt-4">
          <div className="flex flex-col gap-4">
            <Alert variant="info">
              <InfoIcon strokeWidth={2} />
              <AlertTitle>iOS bundle configurations</AlertTitle>
              <AlertDescription>
                Bind certificates and provisioning profiles via the CLI:{" "}
                <code className="font-mono text-xs">
                  better-update credentials generate distribution-certificate
                </code>{" "}
                and{" "}
                <code className="font-mono text-xs">
                  better-update credentials generate provisioning-profile
                </code>
                . The CLI handles the full ASC flow and binds the bundle config in one go.
              </AlertDescription>
            </Alert>
            <Suspense fallback={<CredentialListSkeleton />}>
              <IosSummary orgId={activeOrg.id} projectId={project.id} />
            </Suspense>
          </div>
        </TabsContent>
        <TabsContent value="android" className="pt-4">
          <div className="flex flex-col gap-4">
            <div className="flex justify-end">
              <AndroidBuildWizard orgId={activeOrg.id} projectId={project.id} />
            </div>
            <Suspense fallback={<CredentialListSkeleton />}>
              <AndroidSummary orgId={activeOrg.id} projectId={project.id} />
            </Suspense>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/credentials")({
  component: ProjectCredentials,
});
