import {
  androidApplicationIdentifiersQueryOptions,
  iosBundleConfigurationsQueryOptions,
} from "@better-update/api-client/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import { Skeleton } from "@better-update/ui/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@better-update/ui/components/ui/tabs";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";

import { AndroidBuildWizard } from "./-android-build-wizard";

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

const IosSummary = ({ orgId, projectId }: { orgId: string; projectId: string }) => {
  const { data } = useSuspenseQuery(iosBundleConfigurationsQueryOptions(orgId, projectId));
  if (data.items.length === 0) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle>No iOS bundle configurations</CardTitle>
          <CardDescription>
            Configure per-distribution credentials for this project. App Store, Ad-Hoc, Development,
            or Enterprise each bind a cert, profile, push key, and ASC API key.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {data.items.map((config) => (
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
      ))}
    </div>
  );
};

const AndroidSummary = ({ orgId, projectId }: { orgId: string; projectId: string }) => {
  const { data } = useSuspenseQuery(androidApplicationIdentifiersQueryOptions(orgId, projectId));
  if (data.items.length === 0) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle>No Android app identifiers</CardTitle>
          <CardDescription>
            Create an application identifier to manage upload keystores and Google Service Account
            keys for this project.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {data.items.map((identifier) => (
        <Card key={identifier.id}>
          <CardHeader>
            <CardTitle className="font-mono text-sm">{identifier.packageName}</CardTitle>
            <CardDescription>Android application identifier</CardDescription>
          </CardHeader>
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
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle>iOS bundle configurations</CardTitle>
                <CardDescription>
                  Bind certificates and provisioning profiles via the CLI:{" "}
                  <code className="font-mono text-xs">
                    better-update credentials generate distribution-certificate
                  </code>{" "}
                  and{" "}
                  <code className="font-mono text-xs">
                    better-update credentials generate provisioning-profile
                  </code>
                  . The CLI handles the full ASC flow and binds the bundle config in one go.
                </CardDescription>
              </CardHeader>
            </Card>
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
