import { auditLogsQueryOptions } from "@better-update/api-client/react";
import { safeJsonParse } from "@better-update/safe-json";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import { DateRangePicker } from "@better-update/ui/components/ui/date-range-picker";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import {
  Select,
  SelectPopup,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ChevronLeftIcon, ChevronRightIcon, ScrollTextIcon } from "lucide-react";
import { useState } from "react";

import type { DateRange } from "react-day-picker";

import { List, ListFooter, ListItem, ListSectionHeader } from "../../../components/list-item";
import { formatRelativeTime } from "../../../lib/format-relative-time";
import { pluralize } from "../../../lib/pluralize";
import { truncateId } from "../../../lib/truncate-id";

const RESOURCE_TYPES = [
  { value: "all", label: "All resources" },
  { value: "project", label: "Project" },
  { value: "branch", label: "Branch" },
  { value: "channel", label: "Channel" },
  { value: "update", label: "Update" },
  { value: "build", label: "Build" },
  { value: "credential", label: "Credential" },
  { value: "envVar", label: "Env Var" },
] as const;

const RESOURCE_TYPE_LABELS = Object.fromEntries(RESOURCE_TYPES.map((rt) => [rt.value, rt.label]));

const parseMetadata = (metadata: string | null): unknown => {
  if (!metadata) {
    return null;
  }
  return safeJsonParse(metadata);
};

const EmptyState = ({ scopeLabel }: { scopeLabel: string }) => (
  <Empty appearance="surface">
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <ScrollTextIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>No activity yet</EmptyTitle>
      <EmptyDescription>Actions performed in {scopeLabel} will appear here.</EmptyDescription>
    </EmptyHeader>
  </Empty>
);

export interface AuditLogViewProps {
  readonly orgId: string;
  readonly projectId?: string;
  readonly scopeLabel: string;
}

const formatShortDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

const formatTime = (value: string) =>
  new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

const AuditLogRow = ({
  entry,
}: {
  readonly entry: {
    readonly id: string;
    readonly action: string;
    readonly resourceType: string;
    readonly resourceId: string | null;
    readonly actorEmail: string;
    readonly source: string;
    readonly createdAt: string;
    readonly metadata: string | null;
  };
}) => {
  const [expanded, setExpanded] = useState(false);
  const parsed = parseMetadata(entry.metadata);

  return (
    <div>
      <ListItem
        aside={
          <>
            <span className="text-foreground text-sm leading-5 font-medium">
              {formatShortDate(entry.createdAt)}
            </span>
            <span className="text-muted-foreground/72 text-xs">
              {formatTime(entry.createdAt)} · {formatRelativeTime(entry.createdAt)}
            </span>
          </>
        }
        title={
          <span className="inline-flex items-center gap-2">
            <Badge variant="secondary" className="font-mono text-[10px] tracking-wider uppercase">
              {entry.action}
            </Badge>
            <span className="text-muted-foreground/80 text-sm font-normal">
              {entry.resourceType}
            </span>
            {entry.resourceId ? (
              <code className="text-muted-foreground/72 font-mono text-xs">
                {truncateId(entry.resourceId)}
              </code>
            ) : null}
          </span>
        }
        subtitle={
          <span className="inline-flex items-center gap-2">
            <span>{entry.actorEmail}</span>
            <Badge variant="outline" className="text-[10px]">
              {entry.source === "api-key" ? "API key" : "Session"}
            </Badge>
          </span>
        }
        trailing={
          parsed ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground h-7 px-2 text-xs"
              onClick={() => {
                setExpanded((prev) => !prev);
              }}
            >
              {expanded ? "Hide metadata" : "View metadata"}
            </Button>
          ) : null
        }
      />
      {expanded ? (
        <pre className="bg-muted/40 mx-5 my-2 max-w-2xl overflow-auto rounded-md border p-3 text-xs whitespace-pre-wrap">
          {JSON.stringify(parsed, null, 2)}
        </pre>
      ) : null}
    </div>
  );
};

export const AuditLogView = ({ orgId, projectId, scopeLabel }: AuditLogViewProps) => {
  const [resourceType, setResourceType] = useState("all");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [page, setPage] = useState(1);

  const dateFilter =
    dateRange?.from && dateRange.to
      ? {
          from: dateRange.from.toISOString(),
          to: dateRange.to.toISOString(),
        }
      : {};

  const filters = {
    ...(projectId ? { projectId } : {}),
    ...(resourceType === "all" ? {} : { resourceType }),
    ...dateFilter,
    page,
    limit: 50,
  };

  const { data } = useSuspenseQuery(auditLogsQueryOptions(orgId, filters));
  const totalPages = Math.ceil(data.total / data.limit);

  const handleRangeChange = (value: DateRange | undefined) => {
    setDateRange(value);
    setPage(1);
  };

  const fromIndex = data.items.length === 0 ? 0 : (data.page - 1) * data.limit + 1;
  const toIndex = (data.page - 1) * data.limit + data.items.length;

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          items={RESOURCE_TYPE_LABELS}
          value={resourceType}
          onValueChange={(value) => {
            if (value) {
              setResourceType(value);
              setPage(1);
            }
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All resources" />
          </SelectTrigger>
          <SelectPopup>
            <SelectGroup>
              {RESOURCE_TYPES.map((rt) => (
                <SelectItem key={rt.value} value={rt.value}>
                  {rt.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectPopup>
        </Select>
        <DateRangePicker
          value={dateRange}
          onChange={handleRangeChange}
          triggerClassName="max-w-sm"
        />
      </div>

      {data.items.length === 0 ? (
        <EmptyState scopeLabel={scopeLabel} />
      ) : (
        <List>
          <ListSectionHeader>Activity</ListSectionHeader>
          {data.items.map((entry) => (
            <AuditLogRow key={entry.id} entry={entry} />
          ))}
          <ListFooter>
            <span className="tabular-nums">
              {fromIndex}–{toIndex} of {data.total} {pluralize(data.total, "entry", "entries")}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon-xs"
                disabled={page === 1}
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
                disabled={page >= totalPages}
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
  );
};
