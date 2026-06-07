import { auditLogsInfiniteQueryOptions } from "@better-update/api-client/react";
import { safeJsonParse } from "@better-update/safe-json";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import { Card } from "@better-update/ui/components/ui/card";
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
import { z } from "zod";

import type { DateRange } from "react-day-picker";

import { FilterBarSkeleton, TableSkeleton } from "../../../components/skeletons";
import { enumParam, optionalStringParam } from "../../../lib/data-table";
import { formatTimeShort, formatWeekdayShort } from "../../../lib/format-date";
import { formatRelativeTime } from "../../../lib/format-relative-time";

export const AuditLogSkeleton = () => (
  <div className="flex w-full flex-col gap-4">
    <FilterBarSkeleton selectCount={2} />
    <TableSkeleton columns={5} rows={6} hasFooter={false} />
  </div>
);

// Values mirror the server's AuditLogResourceType union exactly — the audit-log
// repository filters with `WHERE resource_type = ?`, so each option must equal a
// stored value (the old collapsed "credential" alias matched zero rows).
const RESOURCE_TYPE_VALUES = [
  "all",
  "project",
  "branch",
  "channel",
  "update",
  "environment",
  "build",
  "appleCredential",
  "androidCredential",
  "iosBundleConfiguration",
  "iosAppMetadata",
  "envVar",
  "device",
  "webhook",
  "submission",
  "vaultAccess",
  "policy",
  "group",
  "policyAttachment",
  "apiKey",
  "invitation",
  "member",
  "organization",
] as const;

type ResourceTypeValue = (typeof RESOURCE_TYPE_VALUES)[number];

const RESOURCE_TYPE_LABELS: Record<ResourceTypeValue, string> = {
  all: "All resources",
  project: "Project",
  branch: "Branch",
  channel: "Channel",
  update: "Update",
  environment: "Environment",
  build: "Build",
  appleCredential: "Apple credential",
  androidCredential: "Android credential",
  iosBundleConfiguration: "iOS bundle config",
  iosAppMetadata: "iOS app metadata",
  envVar: "Env var",
  device: "Device",
  webhook: "Webhook",
  submission: "Submission",
  vaultAccess: "Vault access",
  policy: "Policy",
  group: "Group",
  policyAttachment: "Policy attachment",
  apiKey: "API key",
  invitation: "Invitation",
  member: "Member",
  organization: "Organization",
};

export const auditLogSearchSchema = z.object({
  resourceType: enumParam(RESOURCE_TYPE_VALUES, "all"),
  from: optionalStringParam(),
  to: optionalStringParam(),
});

export type AuditLogSearch = z.infer<typeof auditLogSearchSchema>;

const isResourceType = (value: unknown): value is ResourceTypeValue =>
  (RESOURCE_TYPE_VALUES as readonly unknown[]).includes(value);

const resourceTypeLabel = (value: string): string =>
  isResourceType(value) ? RESOURCE_TYPE_LABELS[value] : value;

const parseDateRange = (search: AuditLogSearch): DateRange | undefined => {
  if (!search.from || !search.to) {
    return undefined;
  }
  return { from: new Date(search.from), to: new Date(search.to) };
};

const parseMetadata = (metadata: string | null): unknown => {
  if (!metadata) {
    return null;
  }
  return safeJsonParse(metadata);
};

const EmptyState = ({ scopeLabel }: { scopeLabel: string }) => (
  <Card>
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ScrollTextIcon strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>No activity yet</EmptyTitle>
        <EmptyDescription>Actions performed in {scopeLabel} will appear here.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  </Card>
);

export interface AuditLogViewProps {
  readonly orgId: string;
  readonly projectId?: string;
  readonly scopeLabel: string;
  readonly search: AuditLogSearch;
  readonly onChangeSearch: (next: AuditLogSearch) => void;
}

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
            {formatWeekdayShort(entry.createdAt)}
          </span>
          <span className="text-muted-foreground/72 text-xs">
            {formatTimeShort(entry.createdAt)} · {formatRelativeTime(entry.createdAt)}
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
          <span className="text-foreground text-sm">{resourceTypeLabel(entry.resourceType)}</span>
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

export const AuditLogView = ({
  orgId,
  projectId,
  scopeLabel,
  search,
  onChangeSearch,
}: AuditLogViewProps) => {
  const { resourceType, from, to } = search;
  const dateRange = parseDateRange(search);

  const filters = {
    ...(projectId ? { projectId } : {}),
    ...(resourceType === "all" ? {} : { resourceType }),
    ...(from && to ? { from, to } : {}),
  };

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useSuspenseInfiniteQuery(
    auditLogsInfiniteQueryOptions(orgId, filters),
  );

  const items = data.pages.flatMap((page) => page.items);

  const handleResourceTypeChange = (value: ResourceTypeValue): void => {
    onChangeSearch({ ...search, resourceType: value });
  };

  const handleDateRangeChange = (range: DateRange | undefined): void => {
    onChangeSearch({
      ...search,
      ...(range?.from ? { from: range.from.toISOString() } : { from: undefined }),
      ...(range?.to ? { to: range.to.toISOString() } : { to: undefined }),
    });
  };

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          items={RESOURCE_TYPE_LABELS}
          value={resourceType}
          onValueChange={(value) => {
            if (isResourceType(value)) {
              handleResourceTypeChange(value);
            }
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All resources" />
          </SelectTrigger>
          <SelectPopup>
            <SelectGroup>
              {RESOURCE_TYPE_VALUES.map((value) => (
                <SelectItem key={value} value={value}>
                  {RESOURCE_TYPE_LABELS[value]}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectPopup>
        </Select>
        <DateRangePicker
          value={dateRange}
          onChange={handleDateRangeChange}
          triggerClassName="max-w-sm"
        />
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
                      loading={isFetchingNextPage}
                      onClick={async () => {
                        await fetchNextPage();
                      }}
                    >
                      Load more
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
