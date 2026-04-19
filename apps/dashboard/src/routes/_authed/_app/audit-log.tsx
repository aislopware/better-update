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
import { Input } from "@better-update/ui/components/ui/input";
import {
  Select,
  SelectContent,
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
import { createFileRoute } from "@tanstack/react-router";
import { ScrollTextIcon } from "lucide-react";
import { useState } from "react";

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

const formatRelativeTime = (dateString: string): string => {
  const now = Date.now();
  const date = new Date(dateString).getTime();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
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

const truncateId = (id: string | null): string => {
  if (!id) {
    return "-";
  }
  return id.length > 8 ? `${id.slice(0, 8)}...` : id;
};

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

const EmptyState = () => (
  <Card className="border-dashed">
    <CardContent className="flex flex-col items-center justify-center py-12">
      <ScrollTextIcon strokeWidth={1.5} className="text-muted-foreground mb-4 size-12" />
      <p className="text-lg font-medium">No audit log entries yet</p>
      <p className="text-muted-foreground mt-1 text-sm">
        Actions performed in your organization will appear here.
      </p>
    </CardContent>
  </Card>
);

const AuditLogPage = () => {
  const { activeOrg } = Route.useRouteContext();
  const orgId = activeOrg.id;

  const [resourceType, setResourceType] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);

  const filters = {
    ...(resourceType === "all" ? {} : { resourceType }),
    ...(fromDate ? { from: new Date(`${fromDate}T00:00:00`).toISOString() } : {}),
    ...(toDate ? { to: new Date(`${toDate}T23:59:59`).toISOString() } : {}),
    page,
    limit: 50,
  };

  const { data } = useSuspenseQuery(auditLogsQueryOptions(orgId, filters));
  const totalPages = Math.ceil(data.total / data.limit);

  const handleFromChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setFromDate(event.target.value);
    setPage(1);
  };

  const handleToChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setToDate(event.target.value);
    setPage(1);
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Audit Log</h1>
        <p className="text-muted-foreground mt-1">
          Track all actions performed in your organization.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select
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
            {RESOURCE_TYPES.map((rt) => (
              <SelectItem key={rt.value} value={rt.value}>
                {rt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">From</span>
          <Input type="date" className="w-40" value={fromDate} onChange={handleFromChange} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">To</span>
          <Input type="date" className="w-40" value={toDate} onChange={handleToChange} />
        </div>
      </div>

      {data.items.length === 0 ? (
        <EmptyState />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Activity</CardTitle>
            <CardDescription>
              {data.total} {data.total === 1 ? "entry" : "entries"} found.
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

export const Route = createFileRoute("/_authed/_app/audit-log")({
  loader: async ({ context }) => {
    const orgId = context.activeOrg.id;
    await context.queryClient.ensureQueryData(auditLogsQueryOptions(orgId));
  },
  component: AuditLogPage,
});
