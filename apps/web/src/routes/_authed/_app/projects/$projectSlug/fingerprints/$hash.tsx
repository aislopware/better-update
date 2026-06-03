import { fingerprintDetailQueryOptions } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
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
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { FingerprintIcon, PackageIcon } from "lucide-react";
import { Suspense } from "react";

import type { BuildWithArtifact, Update } from "@better-update/api";

import { ProjectSubpageHeader } from "../-project-subpage-header";
import { DistributionBadge, PlatformBadge } from "../../../../../../components/attribute-badges";
import { DetailCardSkeleton } from "../../../../../../components/skeletons";
import { formatDateTime } from "../../../../../../lib/format-date";

interface RouteParams {
  projectSlug: string;
  hash: string;
}

type BuildItem = BuildWithArtifact;
type UpdateItem = Update;

const FingerprintEmpty = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <PackageIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>No builds or updates yet</EmptyTitle>
      <EmptyDescription>
        Nothing in this project has been published with this fingerprint yet.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

const FingerprintHashCard = ({
  hash,
  buildCount,
  updateCount,
}: {
  hash: string;
  buildCount: number;
  updateCount: number;
}) => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <FingerprintIcon strokeWidth={2} className="text-muted-foreground size-5" />
        Fingerprint
      </CardTitle>
      <CardDescription>
        Native + JS surface hash. Builds and updates with this hash are runtime-compatible.
      </CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      <pre className="bg-muted overflow-x-auto rounded-xl p-3 font-mono text-xs">{hash}</pre>
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">{buildCount} builds</Badge>
        <Badge variant="secondary">{updateCount} updates</Badge>
      </div>
    </CardContent>
  </Card>
);

const FingerprintBuildsCard = ({
  projectSlug,
  builds,
}: {
  projectSlug: string;
  builds: readonly BuildItem[];
}) => (
  <Card>
    <CardHeader>
      <CardTitle>Builds ({builds.length})</CardTitle>
      <CardDescription>Binaries produced against this fingerprint.</CardDescription>
    </CardHeader>
    <CardContent>
      {builds.length === 0 ? (
        <p className="text-muted-foreground text-sm">No builds carry this fingerprint.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {builds.map((build) => (
            <Link
              key={build.id}
              to="/projects/$projectSlug/builds/$buildId"
              params={{ projectSlug, buildId: build.id }}
              className="hover:bg-muted/40 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 transition-colors"
            >
              <div className="flex flex-wrap items-center gap-2">
                <PlatformBadge platform={build.platform} />
                <DistributionBadge distribution={build.distribution} />
                <span className="font-medium">v{build.runtimeVersion ?? "—"}</span>
                <span className="text-muted-foreground text-sm">{build.profile}</span>
              </div>
              <span className="text-muted-foreground text-xs">
                {formatDateTime(build.createdAt)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </CardContent>
  </Card>
);

const FingerprintUpdatesCard = ({ updates }: { updates: readonly UpdateItem[] }) => (
  <Card>
    <CardHeader>
      <CardTitle>Updates ({updates.length})</CardTitle>
      <CardDescription>OTA updates published against this fingerprint.</CardDescription>
    </CardHeader>
    <CardContent>
      {updates.length === 0 ? (
        <p className="text-muted-foreground text-sm">No updates carry this fingerprint.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {updates.map((update) => (
            <div
              key={update.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <PlatformBadge platform={update.platform} />
                <span className="font-medium">v{update.runtimeVersion}</span>
                {update.isRollback && <Badge variant="destructive">Rollback</Badge>}
                <span className="text-muted-foreground line-clamp-1 text-sm">{update.message}</span>
              </div>
              <span className="text-muted-foreground text-xs">
                {formatDateTime(update.createdAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </CardContent>
  </Card>
);

const FingerprintContent = ({ projectSlug, hash }: RouteParams) => {
  const { activeOrg, project } = Route.useRouteContext();
  const { data } = useSuspenseQuery(fingerprintDetailQueryOptions(activeOrg.id, project.id, hash));

  if (data.builds.length === 0 && data.updates.length === 0) {
    return (
      <div className="flex w-full flex-col gap-4">
        <ProjectSubpageHeader title="Fingerprint" />
        <FingerprintEmpty />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <ProjectSubpageHeader title="Fingerprint" />
      <FingerprintHashCard
        hash={data.hash}
        buildCount={data.builds.length}
        updateCount={data.updates.length}
      />
      <FingerprintBuildsCard projectSlug={projectSlug} builds={data.builds} />
      <FingerprintUpdatesCard updates={data.updates} />
    </div>
  );
};

const FingerprintPage = () => {
  const { projectSlug, hash } = Route.useParams();
  return (
    <Suspense fallback={<DetailCardSkeleton />}>
      <FingerprintContent projectSlug={projectSlug} hash={hash} />
    </Suspense>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/fingerprints/$hash")({
  component: FingerprintPage,
});
