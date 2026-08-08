import { projectActivityQueryOptions, projectsQueryOptions } from "@better-update/api-client/react";
import { compact } from "@better-update/type-guards";
import { Badge } from "@better-update/ui/components/badge";
import { Empty } from "@better-update/ui/components/empty";
import { LayerCard } from "@better-update/ui/components/layer-card";
import { Skeleton } from "@better-update/ui/components/skeleton";
import { ArchiveIcon, CaretRightIcon, FolderIcon } from "@phosphor-icons/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { differenceInDays } from "date-fns";
import { z } from "zod";

import type { ProjectItem, ProjectSortColumn } from "@better-update/api-client/react";
import type { ReactNode } from "react";

import { ActivitySparkline } from "../../../../components/activity-sparkline";
import { QueryErrorState } from "../../../../components/query-error-state";
import { ResourceListPage } from "../../../../components/resource-list-page";
import { ShippingActivityRail, useSeriesColors } from "../../../../components/shipping-activity";
import { StatusDot } from "../../../../components/status-dot";
import {
  CardList,
  DataTableFacetedFilter,
  DataTableToolbar,
  ListSortMenu,
  PAGE_SIZE,
  computePagination,
  enumArrayParam,
  fireAndForget,
  pageParam,
  queryParam,
  sortParam,
  useDataTableSearch,
  useDebouncedSearch,
} from "../../../../lib/data-table";
import { EntityAvatar } from "../../../../lib/entity-avatar";
import { pluralize } from "../../../../lib/pluralize";
import { RelativeTime } from "../../../../lib/relative-time";
import { CreateProjectDialog } from "./-create-dialog";

import type { ActivityPoint } from "../../../../components/shipping-activity";
import type { FacetedFilterOption } from "../../../../lib/data-table";

const SEARCH_DEBOUNCE_MS = 300;

/** A project with nothing in the window: a flat axis, drawn from no bars. */
const NO_ACTIVITY: readonly ActivityPoint[] = [];

const SORT_COLUMNS = [
  "name",
  "lastActivityAt",
  "createdAt",
  "branchCount",
  "channelCount",
  "updateCount",
] as const satisfies readonly ProjectSortColumn[];

const DEFAULT_SORT = "-lastActivityAt" as const;

// The orders worth naming. Every column stays sortable through the URL, but a
// menu is a list of intents, not an index of fields.
const SORT_OPTIONS = [
  { value: "-lastActivityAt", label: "Recent activity" },
  { value: "name", label: "Name" },
  { value: "-updateCount", label: "Most updates" },
  { value: "-createdAt", label: "Newest" },
] as const;

const STATUS_VALUES = ["active", "archived"] as const;
type StatusFilter = (typeof STATUS_VALUES)[number];

// An empty (or full) chip selection means "all"; the URL default stays
// ["active"] so the page opens on active projects.
const DEFAULT_STATUS = ["active"] as const satisfies readonly StatusFilter[];

const isStatusFilter = (value: unknown): value is StatusFilter =>
  (STATUS_VALUES as readonly unknown[]).includes(value);

const isDefaultStatus = (status: readonly StatusFilter[]): boolean =>
  status.length === 1 && status[0] === "active";

const projectsSearchSchema = z.object({
  page: pageParam(),
  sort: sortParam(DEFAULT_SORT),
  query: queryParam(),
  status: enumArrayParam(STATUS_VALUES, DEFAULT_STATUS),
});

const EmptyState = () => (
  <Empty
    icon={<FolderIcon className="text-kumo-inactive size-10" />}
    title="No projects yet"
    description="Create your first project to start publishing updates."
  />
);

const ACTIVE_WITHIN_DAYS = 7;
const STALE_AFTER_DAYS = 30;

// Health signal for the activity line: green when the project shipped something
// this week, gray when it has gone quiet for over a month. The in-between band
// is the unremarkable default and stays dot-free — color is exception-only.
// Exported for tests.
export const activityTone = (lastActivityAt: string): "success" | "muted" | undefined => {
  const days = differenceInDays(new Date(), new Date(lastActivityAt));
  if (days < ACTIVE_WITHIN_DAYS) {
    return "success";
  }
  return days > STALE_AFTER_DAYS ? "muted" : undefined;
};

// Ongoing activity is the expected state — relative time, with a StatusDot only
// at the fresh/stale extremes. Only the archived exception keeps a badge.
// Exported for tests.
export const ActivityCell = ({ project }: { project: ProjectItem }) => {
  if (project.archivedAt) {
    return (
      <Badge variant="secondary" className="gap-1.5">
        <ArchiveIcon aria-hidden="true" className="size-3" />
        Archived <RelativeTime value={project.archivedAt} />
      </Badge>
    );
  }
  const tone = activityTone(project.lastActivityAt);
  const time = <RelativeTime value={project.lastActivityAt} className="text-kumo-subtle text-sm" />;
  return tone ? <StatusDot tone={tone}>{time}</StatusDot> : time;
};

// One secondary cell for project shape — counts are context, not KPIs, so they
// read as a phrase rather than claiming a column each. Exported for tests.
export const StructureCell = ({ project }: { project: ProjectItem }) => (
  <span className="text-kumo-subtle text-sm whitespace-nowrap">
    {project.branchCount} {pluralize(project.branchCount, "branch", "branches")}
    {" · "}
    {project.channelCount} {pluralize(project.channelCount, "channel")}
  </span>
);

/** The two series' colours, threaded down so every row draws the same blue. */
type SeriesColors = ReturnType<typeof useSeriesColors>;

/**
 * One project as a card rather than a table row: a project is somewhere you go,
 * not a set of values you scan down a column. The name and slug identify it, the
 * strip underneath carries the numbers — the shape Cloudflare uses for Workers,
 * and what Kumo's `LayerCard` draws natively.
 *
 * A month of the project's own shipping sits between the name and the caret,
 * which is what makes the list a comparison rather than a directory: the page
 * used to answer "how much did the organization ship" once, at the top, and
 * nothing at all about the rows underneath it.
 *
 * The whole card is the link. A row-click handler that navigates is a link
 * pretending not to be one: no href to open in a new tab, nothing to copy.
 */
const ProjectCard = ({
  project,
  activity,
  colors,
}: {
  project: ProjectItem;
  /** Absent while the series is still in flight — the slot stays empty, not zero. */
  activity: readonly ActivityPoint[] | undefined;
  colors: SeriesColors;
}) => (
  <Link
    to="/projects/$projectSlug"
    params={{ projectSlug: project.slug }}
    className="group/card focus-visible:ring-kumo-focus block rounded-lg no-underline outline-none focus-visible:ring-2"
  >
    <LayerCard className="group-hover/card:ring-kumo-fill">
      <LayerCard.Primary>
        <div className="flex items-center gap-3">
          <EntityAvatar
            name={project.name}
            seed={project.slug}
            image={project.logoUrl}
            shape="square"
            className="size-9 shrink-0"
          />
          <div className="flex min-w-0 flex-col">
            <span className="text-kumo-default truncate font-medium">{project.name}</span>
            <code className="text-kumo-subtle truncate font-mono text-xs">/{project.slug}</code>
          </div>
          <span className="ml-auto flex shrink-0 items-center gap-3">
            {activity ? (
              <ActivitySparkline
                series={activity}
                colors={colors}
                label={`${project.name}: updates and builds per day over the last 30 days`}
              />
            ) : null}
            <CaretRightIcon aria-hidden weight="bold" className="text-kumo-subtle size-4" />
          </span>
        </div>
      </LayerCard.Primary>
      {/* The tray behind the card: Kumo pulls it under the primary surface so
          only the strip shows, which is where the numbers belong — present when
          looked for, never competing with the name. */}
      <LayerCard.Secondary className="justify-between gap-4 text-sm">
        <span className="flex min-w-0 items-center gap-4">
          <span className="whitespace-nowrap">
            <span className="text-kumo-default tabular-nums">{project.updateCount}</span>{" "}
            {pluralize(project.updateCount, "update")}
          </span>
          <StructureCell project={project} />
        </span>
        <ActivityCell project={project} />
      </LayerCard.Secondary>
    </LayerCard>
  </Link>
);

const projectsSkeleton = (
  <div className="skeleton-appear flex flex-col gap-3">
    {[0, 1, 2, 3, 4].map((index) => (
      <Skeleton key={index} className="h-24 rounded-lg" />
    ))}
  </div>
);

/**
 * How many projects sit either side of the archive line, carried into the
 * Status filter rather than standing beside the list as figures of their own.
 *
 * They used to be two rows in a rail: a count you can act on beats a count you
 * cannot, so they were buttons that set the filter — which left the page with
 * two controls for one axis, the chip in the toolbar and the pair beneath the
 * chart. The filter already draws a count against each option, so the numbers
 * go where the choice is.
 *
 * `limit: 1` — these queries are here for their totals.
 */
const useStatusOptions = (orgId: string): readonly FacetedFilterOption[] => {
  const active = useQuery(projectsQueryOptions(orgId, { limit: 1, status: "active" }));
  const archived = useQuery(projectsQueryOptions(orgId, { limit: 1, status: "archived" }));
  // The count is left off until it arrives rather than shown as a zero: an
  // option reading "Archived 0" while the answer is still in flight is wrong,
  // not pending.
  return [
    { label: "Active", value: "active", ...compact({ count: active.data?.total }) },
    { label: "Archived", value: "archived", ...compact({ count: archived.data?.total }) },
  ];
};

const ProjectsShell = ({ orgId, children }: { orgId: string; children: ReactNode }) => (
  <ResourceListPage
    title="Projects"
    description="Manage your over-the-air update projects."
    actions={<CreateProjectDialog orgId={orgId} />}
    rail={<ShippingActivityRail orgId={orgId} />}
  >
    {children}
  </ResourceListPage>
);

/**
 * Each visible project's own month, keyed by id.
 *
 * One request for the page rather than one per row: twenty cards asking
 * separately is twenty round trips for a shape you read all at once. Projects
 * with nothing in the window come back absent, so `get` returning `undefined`
 * has to be told apart from the query still being in flight — hence the
 * `isPending` flag rather than an empty map standing for both.
 */
const usePageActivity = (
  orgId: string,
  projects: readonly ProjectItem[],
): {
  readonly byProject: ReadonlyMap<string, readonly ActivityPoint[]>;
  readonly isPending: boolean;
} => {
  const projectIds = projects.map((project) => project.id);
  const { data, isPending } = useQuery(projectActivityQueryOptions(orgId, projectIds, "30d"));
  return {
    byProject: new Map((data?.projects ?? []).map((entry) => [entry.projectId, entry.series])),
    isPending: isPending && projectIds.length > 0,
  };
};

const Projects = () => {
  const { activeOrg } = Route.useRouteContext();
  const routeNavigate = Route.useNavigate();
  const { page, sort, query: urlQuery, status } = Route.useSearch();

  const statusOptions = useStatusOptions(activeOrg.id);

  const { apiSort, onSortChange, onPageChange } = useDataTableSearch({
    sortColumns: SORT_COLUMNS,
    defaultSort: DEFAULT_SORT,
    sort,
    navigate: routeNavigate,
  });

  const { draft: searchDraft, setDraft: handleSearchChange } = useDebouncedSearch({
    initial: urlQuery,
    delayMs: SEARCH_DEBOUNCE_MS,
    onCommit: (value) => {
      fireAndForget(
        routeNavigate({
          to: ".",
          search: (prev) => ({ ...prev, query: value, page: 1 }),
          replace: true,
        }),
      );
    },
  });

  const { data, error, isPlaceholderData, isLoading, refetch } = useQuery({
    ...projectsQueryOptions(activeOrg.id, {
      page,
      limit: PAGE_SIZE,
      ...(urlQuery ? { query: urlQuery } : {}),
      sort: apiSort,
      // Both statuses selected ≡ "all" — the API keeps its tri-state param.
      status: status.length === 1 ? (status[0] ?? "all") : "all",
    }),
    placeholderData: keepPreviousData,
  });

  // Both hooks run on every render, so they sit above the early returns; the
  // activity query is disabled until there is a page of ids to ask about.
  const seriesColors = useSeriesColors();
  const activity = usePageActivity(activeOrg.id, data?.items ?? []);

  const handleStatusChange = (next: readonly string[]): void => {
    fireAndForget(
      routeNavigate({
        to: ".",
        search: (prev) => ({ ...prev, status: next.filter(isStatusFilter), page: 1 }),
        replace: true,
      }),
    );
  };

  const handleReset = (): void => {
    handleSearchChange("");
    fireAndForget(
      routeNavigate({
        to: ".",
        search: (prev) => ({ ...prev, query: "", status: [...DEFAULT_STATUS], page: 1 }),
        replace: true,
      }),
    );
  };

  if (isLoading || data === undefined) {
    return (
      <ProjectsShell orgId={activeOrg.id}>
        {error ? <QueryErrorState error={error} onRetry={refetch} /> : projectsSkeleton}
      </ProjectsShell>
    );
  }

  // Only the true "no projects at all" case (active filter, no search) gets the
  // create-your-first-project CTA. An empty archived/all view or empty search
  // keeps the toolbar so the user can change the filter.
  const showsGlobalEmpty =
    data.total === 0 &&
    urlQuery.length === 0 &&
    searchDraft.length === 0 &&
    isDefaultStatus(status);

  if (showsGlobalEmpty) {
    return (
      <ProjectsShell orgId={activeOrg.id}>
        <EmptyState />
      </ProjectsShell>
    );
  }

  const { safePage } = computePagination(data.total, page);
  const isFiltered = urlQuery.length > 0 || !isDefaultStatus(status);

  return (
    <ProjectsShell orgId={activeOrg.id}>
      <div className="flex flex-col gap-3">
        <DataTableToolbar
          search={{
            value: searchDraft,
            onChange: handleSearchChange,
            placeholder: "Search projects…",
          }}
          isFiltered={isFiltered}
          onReset={handleReset}
          actions={<ListSortMenu options={SORT_OPTIONS} value={sort} onChange={onSortChange} />}
        >
          <DataTableFacetedFilter
            title="Status"
            options={statusOptions}
            selected={status}
            onChange={handleStatusChange}
          />
        </DataTableToolbar>
        <CardList
          items={data.items}
          getKey={(project) => project.id}
          renderItem={(project) => (
            <ProjectCard
              project={project}
              // Absent from the response means the project shipped nothing this
              // month, which is a flat axis — not the same as "not answered yet".
              activity={
                activity.isPending ? undefined : (activity.byProject.get(project.id) ?? NO_ACTIVITY)
              }
              colors={seriesColors}
            />
          )}
          isPlaceholderData={isPlaceholderData}
          filteredEmpty={{ entity: "projects", isFiltered, onClear: handleReset }}
          emptyMessage="No projects to show."
          pagination={{
            page: safePage,
            perPage: PAGE_SIZE,
            totalCount: data.total,
            entity: pluralize(data.total, "project"),
            isFiltered: urlQuery.length > 0,
            onChange: onPageChange,
          }}
        />
      </div>
    </ProjectsShell>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/")({
  validateSearch: zodValidator(projectsSearchSchema),
  component: Projects,
});
