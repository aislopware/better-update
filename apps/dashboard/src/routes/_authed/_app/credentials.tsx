import { credentialsQueryOptions } from "@better-update/api-client/react";
import { Card, CardContent } from "@better-update/ui/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@better-update/ui/components/ui/tabs";
import { ShieldKeyIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { orgsQueryOptions, sessionQueryOptions } from "../../../queries/auth";
import { CredentialCard } from "./-credential-card";
import { UploadCredentialDialog } from "./-upload-credential-dialog";

const EmptyState = () => (
  <Card className="border-dashed">
    <CardContent className="flex flex-col items-center justify-center py-12">
      <HugeiconsIcon
        icon={ShieldKeyIcon}
        strokeWidth={1.5}
        className="text-muted-foreground mb-4 size-12"
      />
      <p className="text-lg font-medium">No credentials</p>
      <p className="text-muted-foreground mt-1 text-sm">
        Upload signing credentials to use with CLI builds.
      </p>
    </CardContent>
  </Card>
);

const Credentials = () => {
  const { data: session } = useSuspenseQuery(sessionQueryOptions);
  const { data: orgs } = useSuspenseQuery(orgsQueryOptions);
  const activeOrgId = session?.session.activeOrganizationId ?? "";
  const activeOrg = orgs.find((org) => org.id === activeOrgId) ?? orgs[0];
  const orgId = activeOrg?.id ?? "";

  const [platformFilter, setPlatformFilter] = useState<"all" | "ios" | "android">("all");
  const filters = platformFilter === "all" ? undefined : { platform: platformFilter };

  const { data } = useSuspenseQuery(credentialsQueryOptions(orgId, filters));

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Credentials</h1>
          <p className="text-muted-foreground mt-1">
            Manage signing credentials for iOS and Android builds.
          </p>
        </div>
        <UploadCredentialDialog orgId={orgId} />
      </div>

      <Tabs value={platformFilter} onValueChange={setPlatformFilter}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="ios">iOS</TabsTrigger>
          <TabsTrigger value="android">Android</TabsTrigger>
        </TabsList>
      </Tabs>

      {data.items.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-3">
          {data.items.map((credential) => (
            <CredentialCard key={credential.id} credential={credential} orgId={orgId} />
          ))}
        </div>
      )}
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/credentials")({
  component: Credentials,
});
