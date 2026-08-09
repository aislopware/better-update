import { fingerprintDetailQueryOptions } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/badge";
import { Empty } from "@better-update/ui/components/empty";
import { cn } from "@better-update/ui/lib/utils";
import { CloudArrowUpIcon, PackageIcon } from "@phosphor-icons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";

import type { BuildWithArtifact, Update } from "@better-update/api";
import type { ReactNode } from "react";

import {
  DistributionIndicator,
  PlatformIndicator,
} from "../../../../../../components/attribute-badges";
import { DetailHeader } from "../../../../../../components/detail-header";
import { DetailCardSkeleton } from "../../../../../../components/skeletons";
import { PanelTitle, TablePanel } from "../../../../../../components/table-panel";
import { CopyableId } from "../../../../../../lib/copy-button";
import { useClientPagination } from "../../../../../../lib/data-table";
import { RelativeTime } from "../../../../../../lib/relative-time";
import { ROW_LINK_DIVIDED } from "../../../../../../lib/row-link";

interface RouteParams {
  projectSlug: string;
  hash: string;
}

type BuildItem = BuildWithArtifact;
type UpdateItem = Update;

/** Row shell shared by the two panels: name on top, quiet facts under it, time trailing. */
const ROW_CLASS = cn(ROW_LINK_DIVIDED, "flex items-center justify-between gap-3 px-4 py-3");

const RowBody = ({
  name,
  facts,
  createdAt,
}: {
  name: string;
  facts: ReactNode;
  createdAt: string;
}) => (
  <>
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-sm font-medium">{name}</span>
      <span className="text-kumo-subtle flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {facts}
      </span>
    </div>
    <RelativeTime value={createdAt} className="text-kumo-subtle shrink-0 text-xs" />
  </>
);

const FingerprintBuildsPanel = ({
  projectSlug,
  builds,
}: {
  projectSlug: string;
  builds: readonly BuildItem[];
}) => {
  const pagination = useClientPagination(builds, "build");
  return (
    <TablePanel
      title={<PanelTitle icon={<PackageIcon weight="bold" />} label="Builds" />}
      pagination={builds.length > 0 ? pagination : undefined}
    >
      {builds.length === 0 ? (
        <p className="text-kumo-subtle m-0 px-4 py-3 text-sm">No builds carry this fingerprint.</p>
      ) : (
        pagination.pageItems.map((build) => (
          <Link
            key={build.id}
            to="/projects/$projectSlug/builds/$buildId"
            params={{ projectSlug, buildId: build.id }}
            className={ROW_CLASS}
          >
            <RowBody
              name={build.message ?? build.profile}
              createdAt={build.createdAt}
              facts={
                <>
                  <PlatformIndicator platform={build.platform} className="gap-1" />
                  <DistributionIndicator distribution={build.distribution} className="gap-1" />
                  {build.runtimeVersion ? (
                    <span className="font-mono">v{build.runtimeVersion}</span>
                  ) : null}
                  <span>{build.profile}</span>
                </>
              }
            />
          </Link>
        ))
      )}
    </TablePanel>
  );
};

const FingerprintUpdatesPanel = ({
  projectSlug,
  updates,
}: {
  projectSlug: string;
  updates: readonly UpdateItem[];
}) => {
  const pagination = useClientPagination(updates, "update");
  return (
    <TablePanel
      title={<PanelTitle icon={<CloudArrowUpIcon weight="bold" />} label="Updates" />}
      pagination={updates.length > 0 ? pagination : undefined}
    >
      {updates.length === 0 ? (
        <p className="text-kumo-subtle m-0 px-4 py-3 text-sm">No updates carry this fingerprint.</p>
      ) : (
        pagination.pageItems.map((update) => (
          <Link
            key={update.id}
            to="/projects/$projectSlug/updates/$updateId"
            params={{ projectSlug, updateId: update.id }}
            className={ROW_CLASS}
          >
            <RowBody
              name={update.message || `Update ${update.groupId.slice(0, 8)}`}
              createdAt={update.createdAt}
              facts={
                <>
                  <PlatformIndicator platform={update.platform} className="gap-1" />
                  <span className="font-mono">v{update.runtimeVersion}</span>
                  {update.isRollback ? <Badge variant="error">Rollback</Badge> : null}
                </>
              }
            />
          </Link>
        ))
      )}
    </TablePanel>
  );
};

const FingerprintContent = ({ projectSlug, hash }: RouteParams) => {
  const { activeOrg, project } = Route.useRouteContext();
  const { data } = useSuspenseQuery(fingerprintDetailQueryOptions(activeOrg.id, project.id, hash));

  const buildCount = data.builds.length;
  const updateCount = data.updates.length;

  const header = (
    <DetailHeader
      title="Fingerprint"
      // The hash used to be printed twice — once here and once as a code block
      // in a card titled with the page's own title. This is the copy of it that
      // was already next to the name it belongs to.
      //
      // The two counts that used to follow it are gone as well: each panel below
      // ends in its own count, or says in words that it has nothing, so "1 build
      // 0 updates" was the page reading its own contents out in advance.
      meta={<CopyableId value={hash} label="Fingerprint" length={16} />}
    />
  );

  if (buildCount === 0 && updateCount === 0) {
    return (
      <div className="flex w-full flex-col gap-4">
        {header}
        <Empty
          icon={<PackageIcon className="text-kumo-inactive size-10" />}
          title="No builds or updates yet"
          description="Nothing in this project has been published with this fingerprint yet."
        />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      {header}
      <FingerprintBuildsPanel projectSlug={projectSlug} builds={data.builds} />
      <FingerprintUpdatesPanel projectSlug={projectSlug} updates={data.updates} />
    </div>
  );
};

const FingerprintSkeleton = () => (
  <div className="flex w-full flex-col gap-4">
    <DetailHeader title="Fingerprint" />
    <DetailCardSkeleton rows={3} columns={1} />
    <DetailCardSkeleton rows={3} columns={1} />
  </div>
);

const FingerprintPage = () => {
  const { projectSlug, hash } = Route.useParams();
  return (
    <Suspense fallback={<FingerprintSkeleton />}>
      <FingerprintContent projectSlug={projectSlug} hash={hash} />
    </Suspense>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/fingerprints/$hash")({
  component: FingerprintPage,
});
