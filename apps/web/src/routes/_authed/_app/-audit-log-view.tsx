import { auditLogsQueryOptions } from "@better-update/api-client/react";
import { safeJsonParse } from "@better-update/safe-json";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
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
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ScrollTextIcon } from "lucide-react";
import { useState } from "react";

import type { DateRange } from "react-day-picker";

import { formatRelativeTime } from "../../../lib/format-relative-time";
import { pluralize } from "../../../lib/pluralize";
import { truncateId } from "../../../lib/truncate-id";

const RESOURCE_TYPES = [
  { value: "all", label: "All" },
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

const MetadataCell = ({ raw }: { raw: string | null }) => {
  const [expanded, setExpanded] = useState(false);
  const parsed = parseMetadata(raw);

  if (!parsed) {
    return <span className="text-muted-foreground">-</span>;
  }

  if (!expanded) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-xs"
        onClick={() => {
          setExpanded(true);
        }}
      >
        View
      </Button>
    );
  }

  return (
    <div className="max-w-48">
      <pre className="bg-muted overflow-auto rounded p-1 text-xs whitespace-pre-wrap">
        {JSON.stringify(parsed, null, 2)}
      </pre>
      <Button
        variant="ghost"
        size="sm"
        className="mt-1 h-5 px-2 text-xs"
        onClick={() => {
          setExpanded(false);
        }}
      >
        Hide
      </Button>
    </div>
  );
};

const ActorCell = ({
  actorEmail,
  source,
}: {
  actorEmail: string;
  source: "session" | "api-key";
}) => (
  <div className="flex items-center gap-2">
    <span className="truncate text-sm">{actorEmail}</span>
    <Badge variant="outline" className="text-xs">
      {source === "api-key" ? "API Key" : "Session"}
    </Badge>
  </div>
);

const EmptyState = ({ scopeLabel }: { scopeLabel: string }) => (
  <Empty className="border">
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <ScrollTextIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>No audit log entries yet</EmptyTitle>
      <EmptyDescription>Actions performed in {scopeLabel} will appear here.</EmptyDescription>
    </EmptyHeader>
  </Empty>
);

export interface AuditLogViewProps {
  readonly orgId: string;
  readonly projectId?: string;
  readonly scopeLabel: string;
}

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const endOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);

export const AuditLogView = ({ orgId, projectId, scopeLabel }: AuditLogViewProps) => {
  const [resourceType, setResourceType] = useState("all");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [page, setPage] = useState(1);

  const filters = {
    ...(projectId ? { projectId } : {}),
    ...(resourceType === "all" ? {} : { resourceType }),
    ...(dateRange?.from ? { from: startOfDay(dateRange.from).toISOString() } : {}),
    ...(dateRange?.to ? { to: endOfDay(dateRange.to).toISOString() } : {}),
    page,
    limit: 50,
  };

  const { data } = useSuspenseQuery(auditLogsQueryOptions(orgId, filters));
  const totalPages = Math.ceil(data.total / data.limit);

  const handleRangeChange = (value: DateRange | undefined) => {
    setDateRange(value);
    setPage(1);
  };

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
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Resource type" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {RESOURCE_TYPES.map((rt) => (
                <SelectItem key={rt.value} value={rt.value}>
                  {rt.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <DateRangePicker value={dateRange} onChange={handleRangeChange} />
      </div>

      {data.items.length === 0 ? (
        <EmptyState scopeLabel={scopeLabel} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Activity</CardTitle>
            <CardDescription>
              {data.total} {pluralize(data.total, "entry", "entries")} found.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                      {formatRelativeTime(entry.createdAt)}
                    </TableCell>
                    <TableCell>
                      <ActorCell actorEmail={entry.actorEmail} source={entry.source} />
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{entry.action}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className="text-muted-foreground">{entry.resourceType}</span>
                      {entry.resourceId ? (
                        <span className="ml-1 font-mono text-xs">
                          {truncateId(entry.resourceId)}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <MetadataCell raw={entry.metadata} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
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
