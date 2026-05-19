import { iosBundleConfigurationsQueryOptions } from "@better-update/api-client/react";
import { Skeleton } from "@better-update/ui/components/ui/skeleton";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";

import type { ReactNode } from "react";

import { IosBuildCredentialsSection } from "./-ios-build-credentials";
import { IosDetailHeader, IosNotFoundEmpty } from "./-ios-detail-header";
import { IosServiceCredentialsSection } from "./-ios-service-credentials";

const HeaderSkeleton = () => (
  <div className="flex flex-col gap-3">
    <Skeleton className="h-4 w-48 rounded" />
    <Skeleton className="h-8 w-72 rounded" />
  </div>
);

const SectionSkeleton = () => (
  <div className="flex flex-col gap-3">
    <Skeleton className="h-4 w-32 rounded" />
    <Skeleton className="h-32 w-full rounded-xl" />
  </div>
);

const ExistenceGate = ({
  orgId,
  projectId,
  projectSlug,
  bundleIdentifier,
  children,
}: {
  orgId: string;
  projectId: string;
  projectSlug: string;
  bundleIdentifier: string;
  children: ReactNode;
}): ReactNode => {
  const { data: configsResult } = useSuspenseQuery(
    iosBundleConfigurationsQueryOptions(orgId, projectId),
  );
  const configs = configsResult.items.filter(
    (config) => config.bundleIdentifier === bundleIdentifier,
  );
  if (configs.length === 0) {
    return <IosNotFoundEmpty projectSlug={projectSlug} bundleIdentifier={bundleIdentifier} />;
  }
  return <div className="contents">{children}</div>;
};

const IosCredentialsDetail = () => {
  const { activeOrg, project } = Route.useRouteContext();
  const { projectSlug, bundleIdentifier } = Route.useParams();
  const orgId = activeOrg.id;
  const projectId = project.id;

  return (
    <div className="flex w-full flex-col gap-8">
      <Suspense fallback={<HeaderSkeleton />}>
        <IosDetailHeader
          orgId={orgId}
          projectId={projectId}
          projectSlug={projectSlug}
          bundleIdentifier={bundleIdentifier}
        />
      </Suspense>
      <Suspense fallback={<SectionSkeleton />}>
        <ExistenceGate
          orgId={orgId}
          projectId={projectId}
          projectSlug={projectSlug}
          bundleIdentifier={bundleIdentifier}
        >
          <IosBuildCredentialsSection
            orgId={orgId}
            projectId={projectId}
            bundleIdentifier={bundleIdentifier}
          />
          <IosServiceCredentialsSection
            orgId={orgId}
            projectId={projectId}
            bundleIdentifier={bundleIdentifier}
          />
        </ExistenceGate>
      </Suspense>
    </div>
  );
};

export const Route = createFileRoute(
  "/_authed/_app/projects/$projectSlug/credentials/ios/$bundleIdentifier",
)({
  component: IosCredentialsDetail,
});
