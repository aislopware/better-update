import { credentialsQueryOptions } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import { Card, CardContent } from "@better-update/ui/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@better-update/ui/components/ui/tabs";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheckIcon } from "lucide-react";
import { useState } from "react";

import { CredentialCard } from "./-credential-card";
import { UploadCredentialDialog } from "./-upload-credential-dialog";

const EmptyState = () => (
  <Card className="border-dashed">
    <CardContent className="flex flex-col items-center justify-center py-12">
      <ShieldCheckIcon strokeWidth={1.5} className="text-muted-foreground mb-4 size-12" />
      <p className="text-lg font-medium">No credentials</p>
      <p className="text-muted-foreground mt-1 text-sm">
        Upload signing credentials to use with CLI builds.
      </p>
    </CardContent>
  </Card>
);

const Credentials = () => {
  const { activeOrg } = Route.useRouteContext();
  const orgId = activeOrg.id;

  const [platformFilter, setPlatformFilter] = useState("all");
  const [page, setPage] = useState(1);
  const platformParam: "ios" | "android" | undefined =
    platformFilter === "ios" || platformFilter === "android" ? platformFilter : undefined;
  const filters = platformParam ? { platform: platformParam } : undefined;

  const { data } = useSuspenseQuery(credentialsQueryOptions(orgId, filters, page));
  const totalPages = Math.ceil(data.total / data.limit);

  const handlePlatformChange = (value: string) => {
    setPlatformFilter(value);
    setPage(1);
  };

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

      <Tabs value={platformFilter} onValueChange={handlePlatformChange}>
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

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1}
            onClick={() => {
              setPage((prev) => prev - 1);
            }}
          >
            Previous
          </Button>
          <span className="text-muted-foreground text-sm">
            Page {data.page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page * data.limit >= data.total}
            onClick={() => {
              setPage((prev) => prev + 1);
            }}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/credentials")({
  component: Credentials,
});
