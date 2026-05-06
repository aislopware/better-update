import { auditLogsInfiniteQueryOptions } from "@better-update/api-client/react";
import { safeJsonParse } from "@better-update/safe-json";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import { DateRangePicker } from "@better-update/ui/components/ui/date-range-picker";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "@better-update/ui/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { Frame } from "@better-update/ui/components/ui/frame";
import {
  Select,
  SelectPopup,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { BracesIcon, ScrollTextIcon } from "lucide-react";
import { useState } from "react";

import type { DateRange } from "react-day-picker";

import { formatRelativeTime } from "../../../lib/format-relative-time";

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
  const parsed = parseMetadata(entry.metadata);

  return (
    <TableRow>
      <TableCell className="align-top whitespace-nowrap">
        <div className="flex flex-col">
          <span className="text-foreground text-sm leading-5 font-medium">
            {formatShortDate(entry.createdAt)}
          </span>
          <span className="text-muted-foreground/72 text-xs">
            {formatTime(entry.createdAt)} · {formatRelativeTime(entry.createdAt)}
          </span>
        </div>
      </TableCell>
      <TableCell className="align-top">
        <Badge variant="secondary" className="font-mono text-[10px] tracking-wider uppercase">
          {entry.action}
        </Badge>
      </TableCell>
      <TableCell className="align-top">
        <div className="flex flex-col gap-0.5">
          <span className="text-foreground text-sm">{entry.resourceType}</span>
          {entry.resourceId ? (
            <code className="text-muted-foreground/72 font-mono text-xs break-all">
              {entry.resourceId}
            </code>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="align-top">
        <div className="flex flex-col items-start gap-1">
          <span className="text-foreground text-sm">{entry.actorEmail}</span>
          <Badge variant="outline" className="text-[10px]">
            {entry.source === "api-key" ? "API key" : "Session"}
          </Badge>
        </div>
      </TableCell>
      <TableCell className="text-right align-middle in-data-[variant=card]:last:pe-4">
        {parsed ? <MetadataDialog action={entry.action} parsed={parsed} /> : null}
      </TableCell>
    </TableRow>
  );
};

const metadataTrigger = (
  <Button
    variant="outline"
    size="icon-xs"
    aria-label="View metadata"
    className="text-muted-foreground"
  >
    <BracesIcon strokeWidth={2} />
  </Button>
);

const MetadataDialog = ({
  action,
  parsed,
}: {
  readonly action: string;
  readonly parsed: unknown;
}) => (
  <Dialog>
    <DialogTrigger render={metadataTrigger} />
    <DialogPopup className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>
          <span className="font-mono text-xs tracking-wider uppercase">{action}</span> metadata
        </DialogTitle>
        <DialogDescription>Raw event payload recorded for this audit entry.</DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <pre className="bg-muted/40 max-h-[60vh] overflow-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">
          {JSON.stringify(parsed, null, 2)}
        </pre>
      </DialogPanel>
    </DialogPopup>
  </Dialog>
);

export const AuditLogView = ({ orgId, projectId, scopeLabel }: AuditLogViewProps) => {
  const [resourceType, setResourceType] = useState("all");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  const filters = {
    ...(projectId ? { projectId } : {}),
    ...(resourceType === "all" ? {} : { resourceType }),
    ...(dateRange?.from && dateRange.to
      ? { from: dateRange.from.toISOString(), to: dateRange.to.toISOString() }
      : {}),
  };

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useSuspenseInfiniteQuery(
    auditLogsInfiniteQueryOptions(orgId, filters),
  );

  const items = data.pages.flatMap((page) => page.items);

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          items={RESOURCE_TYPE_LABELS}
          value={resourceType}
          onValueChange={(value) => {
            if (value) {
              setResourceType(value);
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
        <DateRangePicker value={dateRange} onChange={setDateRange} triggerClassName="max-w-sm" />
      </div>

      {items.length === 0 ? (
        <EmptyState scopeLabel={scopeLabel} />
      ) : (
        <Frame>
          <Table variant="card">
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead className="w-16 pe-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((entry) => (
                <AuditLogRow key={entry.id} entry={entry} />
              ))}
            </TableBody>
            {hasNextPage ? (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={5} className="text-center">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isFetchingNextPage}
                      onClick={async () => {
                        await fetchNextPage();
                      }}
                    >
                      {isFetchingNextPage ? "Loading…" : "Load more"}
                    </Button>
                  </TableCell>
                </TableRow>
              </TableFooter>
            ) : null}
          </Table>
        </Frame>
      )}
    </div>
  );
};
