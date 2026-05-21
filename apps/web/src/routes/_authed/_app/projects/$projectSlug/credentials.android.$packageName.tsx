import { androidApplicationIdentifiersQueryOptions } from "@better-update/api-client/react";
import { Skeleton } from "@better-update/ui/components/ui/skeleton";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";

import type { ReactNode } from "react";

import { AndroidBuildCredentialsSection } from "./-android-build-credentials";
import { AndroidDetailHeader, AndroidNotFoundEmpty } from "./-android-detail-header";
import { AndroidServiceCredentialsSection } from "./-android-service-credentials";

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
  packageName,
  children,
}: {
  orgId: string;
  projectId: string;
  projectSlug: string;
  packageName: string;
  children: ReactNode;
}): ReactNode => {
  const { data: identifiersResult } = useSuspenseQuery(
    androidApplicationIdentifiersQueryOptions(orgId, projectId),
  );
  const identifier = identifiersResult.items.find((item) => item.packageName === packageName);
  if (identifier === undefined) {
    return <AndroidNotFoundEmpty projectSlug={projectSlug} packageName={packageName} />;
  }
  return <div className="contents">{children}</div>;
};

const AndroidCredentialsDetail = () => {
  const { activeOrg, project } = Route.useRouteContext();
  const { projectSlug, packageName } = Route.useParams();
  const orgId = activeOrg.id;
  const projectId = project.id;

  return (
    <div className="flex w-full flex-col gap-8">
      <Suspense fallback={<HeaderSkeleton />}>
        <AndroidDetailHeader projectSlug={projectSlug} packageName={packageName} />
      </Suspense>
      <Suspense fallback={<SectionSkeleton />}>
        <ExistenceGate
          orgId={orgId}
          projectId={projectId}
          projectSlug={projectSlug}
          packageName={packageName}
        >
          <AndroidBuildCredentialsSection
            orgId={orgId}
            projectId={projectId}
            packageName={packageName}
          />
          <AndroidServiceCredentialsSection
            orgId={orgId}
            projectId={projectId}
            packageName={packageName}
          />
        </ExistenceGate>
      </Suspense>
    </div>
  );
};

export const Route = createFileRoute(
  "/_authed/_app/projects/$projectSlug/credentials/android/$packageName",
)({
  component: AndroidCredentialsDetail,
});
