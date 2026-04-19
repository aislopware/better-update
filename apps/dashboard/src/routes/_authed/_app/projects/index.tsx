import { projectsQueryOptions } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import { Card, CardContent } from "@better-update/ui/components/ui/card";
import { DateRangePicker } from "@better-update/ui/components/ui/date-range-picker";
import { Input } from "@better-update/ui/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronsUpDownIcon,
  FolderIcon,
  SearchIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { ProjectItem } from "@better-update/api-client/react";
import type { DateRange } from "react-day-picker";

import { CreateProjectDialog } from "./-create-dialog";

type SortKey = "name" | "slug" | "lastActivityAt" | "createdAt";
type SortDir = "asc" | "desc";

const formatRelativeTime = (dateString: string): string => {
  const now = Date.now();
  const date = new Date(dateString).getTime();
  const diffSec = Math.floor((now - date) / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) {
    return "just now";
  }
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  if (diffHr < 24) {
    return `${diffHr}h ago`;
  }
  if (diffDay < 30) {
    return `${diffDay}d ago`;
  }
  return new Date(dateString).toLocaleDateString();
};

const SortHeader = ({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) => {
  const activeIcon = dir === "asc" ? ArrowUpIcon : ArrowDownIcon;
  const Icon = active ? activeIcon : ChevronsUpDownIcon;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="data-[state=open]:bg-accent -ml-2 h-8 px-2"
      onClick={onClick}
    >
      <span>{label}</span>
      <Icon className="ml-1 size-3.5" />
    </Button>
  );
};

const EmptyState = () => (
  <Card className="border-dashed">
    <CardContent className="flex flex-col items-center justify-center py-12">
      <FolderIcon strokeWidth={1.5} className="text-muted-foreground mb-4 size-12" />
      <p className="text-lg font-medium">No projects yet</p>
      <p className="text-muted-foreground mt-1 text-sm">
        Create your first project to start publishing updates.
      </p>
    </CardContent>
  </Card>
);

const NoResultsRow = () => (
  <TableRow>
    <TableCell colSpan={4} className="text-muted-foreground h-24 text-center">
      No projects match your filters.
    </TableCell>
  </TableRow>
);

interface FiltersBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  dateRange: DateRange | undefined;
  onDateRangeChange: (value: DateRange | undefined) => void;
  onClear: () => void;
  filteredCount: number;
  totalCount: number;
  action?: React.ReactNode;
}

const FiltersBar = ({
  search,
  onSearchChange,
  dateRange,
  onDateRangeChange,
  onClear,
  filteredCount,
  totalCount,
  action,
}: FiltersBarProps) => {
  const hasActive = Boolean(search || dateRange?.from || dateRange?.to);
  const countLabel =
    filteredCount === totalCount
      ? `${totalCount} ${totalCount === 1 ? "project" : "projects"}`
      : `${filteredCount} of ${totalCount}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-64">
        <SearchIcon className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          placeholder="Search name or scope key…"
          value={search}
          onChange={(event) => {
            onSearchChange(event.target.value);
          }}
          className="pl-8"
        />
      </div>
      <DateRangePicker value={dateRange} onChange={onDateRangeChange} placeholder="Created date" />
      {hasActive && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
      )}
      <div className="text-muted-foreground text-sm">{countLabel}</div>
      {action ? <div className="ml-auto">{action}</div> : null}
    </div>
  );
};

const ProjectRow = ({ project }: { project: ProjectItem }) => (
  <TableRow className="cursor-pointer">
    <TableCell className="font-medium">
      <Link
        to="/projects/$projectSlug"
        params={{ projectSlug: project.slug }}
        className="flex items-center gap-2 hover:underline"
      >
        <FolderIcon strokeWidth={2} className="text-muted-foreground size-4" />
        {project.name}
      </Link>
    </TableCell>
    <TableCell>
      <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">{project.slug}</code>
    </TableCell>
    <TableCell className="text-muted-foreground text-sm">
      {formatRelativeTime(project.lastActivityAt)}
    </TableCell>
    <TableCell>
      <Badge variant="outline">{new Date(project.createdAt).toLocaleDateString()}</Badge>
    </TableCell>
  </TableRow>
);

interface ProjectsTableProps {
  rows: readonly ProjectItem[];
  sortKey: SortKey;
  sortDir: SortDir;
  onToggleSort: (key: SortKey) => void;
}

const ProjectsTable = ({ rows, sortKey, sortDir, onToggleSort }: ProjectsTableProps) => (
  <Card className="gap-0 py-0">
    <CardContent className="p-0">
      <Table className="[&_td]:px-4 [&_td]:py-3 [&_th]:px-4 [&_th]:py-3">
        <TableHeader>
          <TableRow>
            <TableHead>
              <SortHeader
                label="Name"
                active={sortKey === "name"}
                dir={sortDir}
                onClick={() => {
                  onToggleSort("name");
                }}
              />
            </TableHead>
            <TableHead>
              <SortHeader
                label="Slug"
                active={sortKey === "slug"}
                dir={sortDir}
                onClick={() => {
                  onToggleSort("slug");
                }}
              />
            </TableHead>
            <TableHead className="w-40">
              <SortHeader
                label="Last activity"
                active={sortKey === "lastActivityAt"}
                dir={sortDir}
                onClick={() => {
                  onToggleSort("lastActivityAt");
                }}
              />
            </TableHead>
            <TableHead className="w-40">
              <SortHeader
                label="Created"
                active={sortKey === "createdAt"}
                dir={sortDir}
                onClick={() => {
                  onToggleSort("createdAt");
                }}
              />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <NoResultsRow />
          ) : (
            rows.map((project) => <ProjectRow key={project.id} project={project} />)
          )}
        </TableBody>
      </Table>
    </CardContent>
  </Card>
);

const compareBy = (dir: SortDir) => (left: string | number, right: string | number) => {
  if (left === right) {
    return 0;
  }
  const result = left < right ? -1 : 1;
  return dir === "asc" ? result : -result;
};

const Projects = () => {
  const { activeOrg } = Route.useRouteContext();
  const orgId = activeOrg.id;

  const { data } = useSuspenseQuery(projectsQueryOptions(orgId, 1, 1000));

  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [sortKey, setSortKey] = useState<SortKey>("lastActivityAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const fromTs = dateRange?.from
      ? new Date(
          dateRange.from.getFullYear(),
          dateRange.from.getMonth(),
          dateRange.from.getDate(),
        ).getTime()
      : null;
    const toTs = dateRange?.to
      ? new Date(
          dateRange.to.getFullYear(),
          dateRange.to.getMonth(),
          dateRange.to.getDate(),
          23,
          59,
          59,
        ).getTime()
      : null;

    const filtered = data.items.filter((project: ProjectItem) => {
      const name = project.name.toLowerCase();
      const slug = project.slug.toLowerCase();
      if (query && !name.includes(query) && !slug.includes(query)) {
        return false;
      }
      const createdTs = new Date(project.createdAt).getTime();
      if (fromTs !== null && createdTs < fromTs) {
        return false;
      }
      if (toTs !== null && createdTs > toTs) {
        return false;
      }
      return true;
    });

    const cmp = compareBy(sortDir);
    return [...filtered].toSorted((left, right) => {
      if (sortKey === "createdAt" || sortKey === "lastActivityAt") {
        return cmp(new Date(left[sortKey]).getTime(), new Date(right[sortKey]).getTime());
      }
      return cmp(left[sortKey].toLowerCase(), right[sortKey].toLowerCase());
    });
  }, [data.items, search, dateRange, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(key === "createdAt" || key === "lastActivityAt" ? "desc" : "asc");
  };

  const totalCount = data.items.length;
  const filteredCount = rows.length;
  const createCta = useMemo(() => <CreateProjectDialog orgId={orgId} />, [orgId]);

  return (
    <div className="flex w-full flex-col gap-4">
      {totalCount === 0 ? (
        <>
          <div className="flex justify-end">{createCta}</div>
          <EmptyState />
        </>
      ) : (
        <>
          <FiltersBar
            search={search}
            onSearchChange={setSearch}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            onClear={() => {
              setSearch("");
              setDateRange(undefined);
            }}
            filteredCount={filteredCount}
            totalCount={totalCount}
            action={createCta}
          />
          <ProjectsTable
            rows={rows}
            sortKey={sortKey}
            sortDir={sortDir}
            onToggleSort={toggleSort}
          />
        </>
      )}
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/")({
  component: Projects,
});
