import { projectsQueryOptions } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { Input } from "@better-update/ui/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuPopup,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@better-update/ui/components/ui/menu";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FolderIcon,
  SearchIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { ProjectItem } from "@better-update/api-client/react";

import { List, ListFooter, ListItem, ListSectionHeader } from "../../../../components/list-item";
import { PageHeader } from "../../../../components/page-header";
import { EntityAvatar } from "../../../../lib/entity-avatar";
import { formatRelativeTime } from "../../../../lib/format-relative-time";
import { pluralize } from "../../../../lib/pluralize";
import { CreateProjectDialog } from "./-create-dialog";

const PAGE_SIZE = 50;

type SortId = "lastActivityAt" | "name";

const SORT_LABELS: Record<SortId, string> = {
  lastActivityAt: "Last activity",
  name: "Name",
};

const SORT_OPTIONS: readonly { value: SortId; label: string }[] = [
  { value: "lastActivityAt", label: SORT_LABELS.lastActivityAt },
  { value: "name", label: SORT_LABELS.name },
];

const sortTrigger = (
  <Button variant="outline" size="icon" aria-label="Sort">
    <SlidersHorizontalIcon strokeWidth={2} />
  </Button>
);

const SortDropdown = ({ value, onChange }: { value: SortId; onChange: (next: SortId) => void }) => (
  <DropdownMenu>
    <DropdownMenuTrigger render={sortTrigger} />
    <DropdownMenuPopup align="end" className="w-44">
      <DropdownMenuGroup>
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {SORT_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => {
              onChange(option.value);
            }}
          >
            <span className="flex-1">{option.label}</span>
            {option.value === value ? <CheckIcon strokeWidth={2} className="text-primary" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>
    </DropdownMenuPopup>
  </DropdownMenu>
);

const EmptyState = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <FolderIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>No projects yet</EmptyTitle>
      <EmptyDescription>Create your first project to start publishing updates.</EmptyDescription>
    </EmptyHeader>
  </Empty>
);

const formatShortDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

const MetaSeparator = () => (
  <span aria-hidden="true" className="text-muted-foreground/40">
    ·
  </span>
);

const ProjectRow = ({ project }: { project: ProjectItem }) => (
  <Link
    to="/projects/$projectSlug"
    params={{ projectSlug: project.slug }}
    className="focus-visible:bg-muted/40 block outline-none"
  >
    <ListItem
      aside={
        <>
          <span className="text-foreground text-sm leading-5 font-medium">
            Active {formatRelativeTime(project.lastActivityAt)}
          </span>
          <span className="text-muted-foreground/72 text-xs">
            Created {formatShortDate(project.createdAt)}
          </span>
        </>
      }
      leading={
        <EntityAvatar name={project.name} seed={project.slug} size="default" shape="square" />
      }
      title={project.name}
      subtitle={
        <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <code className="font-mono">/{project.slug}</code>
          <MetaSeparator />
          <span className="tabular-nums">
            {project.branchCount} {pluralize(project.branchCount, "branch", "branches")}
          </span>
          <MetaSeparator />
          <span className="tabular-nums">
            {project.channelCount} {pluralize(project.channelCount, "channel")}
          </span>
          <MetaSeparator />
          <span className="tabular-nums">
            {project.updateCount} {pluralize(project.updateCount, "update")}
          </span>
        </span>
      }
      trailing={
        <ChevronRightIcon
          strokeWidth={2}
          className="text-muted-foreground/72 group-hover:text-foreground size-4 transition-colors"
        />
      }
    />
  </Link>
);

const Projects = () => {
  const { activeOrg } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const { data } = useSuspenseQuery(projectsQueryOptions(orgId, 1, 1000));

  const [globalFilter, setGlobalFilter] = useState("");
  const [sortId, setSortId] = useState<SortId>("lastActivityAt");
  const [page, setPage] = useState(1);

  const handleFilterChange = (value: string) => {
    setGlobalFilter(value);
    setPage(1);
  };

  const handleSortChange = (next: SortId) => {
    setSortId(next);
    setPage(1);
  };

  const filtered = useMemo(() => {
    const query = globalFilter.trim().toLowerCase();
    const items = query
      ? data.items.filter(
          (project) =>
            project.name.toLowerCase().includes(query) ||
            project.slug.toLowerCase().includes(query),
        )
      : [...data.items];
    items.sort((left, right) => {
      if (sortId === "name") {
        return left.name.localeCompare(right.name);
      }
      return new Date(right.lastActivityAt).getTime() - new Date(left.lastActivityAt).getTime();
    });
    return items;
  }, [data.items, globalFilter, sortId]);

  const totalCount = data.items.length;
  const filteredCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  );
  const fromIndex = paginated.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const toIndex = (safePage - 1) * PAGE_SIZE + paginated.length;
  const createCta = useMemo(() => <CreateProjectDialog orgId={orgId} />, [orgId]);

  if (totalCount === 0) {
    return (
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          title="Projects"
          description="Manage your over-the-air update projects."
          actions={createCta}
        />
        <EmptyState />
      </div>
    );
  }

  const countLabel =
    filteredCount === totalCount
      ? `${fromIndex}–${toIndex} of ${totalCount} ${pluralize(totalCount, "project")}`
      : `${fromIndex}–${toIndex} of ${filteredCount} ${pluralize(filteredCount, "project")} (filtered)`;

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title="Projects"
        description="Manage your over-the-air update projects."
        actions={createCta}
      />
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1">
            <SearchIcon className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              placeholder="Search projects…"
              value={globalFilter}
              onChange={(event) => {
                handleFilterChange(event.target.value);
              }}
              className="pl-8"
            />
          </div>
          <SortDropdown value={sortId} onChange={handleSortChange} />
        </div>
        {filteredCount === 0 ? (
          <p className="text-muted-foreground rounded-xl border border-dashed py-10 text-center text-sm">
            No projects match your search.
          </p>
        ) : (
          <List>
            <ListSectionHeader>All projects</ListSectionHeader>
            {paginated.map((project) => (
              <ProjectRow key={project.id} project={project} />
            ))}
            <ListFooter>
              <span className="tabular-nums">{countLabel}</span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon-xs"
                  disabled={safePage === 1}
                  onClick={() => {
                    setPage((prev) => prev - 1);
                  }}
                  aria-label="Previous page"
                >
                  <ChevronLeftIcon strokeWidth={2} />
                </Button>
                <Button
                  variant="outline"
                  size="icon-xs"
                  disabled={safePage >= totalPages}
                  onClick={() => {
                    setPage((prev) => prev + 1);
                  }}
                  aria-label="Next page"
                >
                  <ChevronRightIcon strokeWidth={2} />
                </Button>
              </div>
            </ListFooter>
          </List>
        )}
      </div>
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/")({
  component: Projects,
});
