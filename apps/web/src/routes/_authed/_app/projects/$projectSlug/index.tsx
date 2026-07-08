import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { Suspense } from "react";

import { PageHeader, SectionHeader } from "../../../../../components/page-header";
import { DetailCardSkeleton } from "../../../../../components/skeletons";
import { fireAndForget } from "../../../../../lib/data-table";
import { AnalyticsTab, analyticsSearchSchema } from "./-analytics-tab";
import { OverviewContent } from "./-overview-content";

const ProjectOverview = () => {
  const { activeOrg, project } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <div className="flex w-full flex-col gap-8">
      <PageHeader
        size="sub"
        title={project.name}
        description="What's live on each channel and what changed recently."
      />
      <Suspense fallback={<DetailCardSkeleton rows={3} columns={2} />}>
        <OverviewContent
          scope={{ orgId: activeOrg.id, projectId: project.id, projectSlug: project.slug }}
        />
      </Suspense>
      <section className="flex flex-col gap-4">
        <SectionHeader
          title="Analytics"
          description="Adoption and request traffic reported by devices."
        />
        <AnalyticsTab
          orgId={activeOrg.id}
          projectId={project.id}
          search={search}
          onSearchChange={(next) => {
            fireAndForget(navigate({ to: ".", search: (prev) => ({ ...prev, ...next }) }));
          }}
        />
      </section>
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/")({
  validateSearch: zodValidator(analyticsSearchSchema),
  component: ProjectOverview,
});
