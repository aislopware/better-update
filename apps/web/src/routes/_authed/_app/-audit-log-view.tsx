import { auditLogsInfiniteQueryOptions } from "@better-update/api-client/react";
import { safeJsonParse } from "@better-update/safe-json";
import { Button } from "@better-update/ui/components/ui/button";
import { Card } from "@better-update/ui/components/ui/card";
import { DateRangePicker } from "@better-update/ui/components/ui/date-range-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
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
import { Spinner } from "@better-update/ui/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { BotIcon, BracesIcon, ScrollTextIcon } from "lucide-react";
import { z } from "zod";

import type { DateRange } from "react-day-picker";

import { FilterBarSkeleton, TableSkeleton } from "../../../components/skeletons";
import { CopyButton } from "../../../lib/copy-button";
import {
  DataTableFacetedFilter,
  DataTableToolbar,
  enumArrayParam,
  optionalStringParam,
} from "../../../lib/data-table";
import { EntityAvatar } from "../../../lib/entity-avatar";
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
  "robotAccount",
  "invitation",
  "member",
  "organization",
] as const;

type ResourceTypeValue = (typeof RESOURCE_TYPE_VALUES)[number];

const RESOURCE_TYPE_LABELS: Record<ResourceTypeValue, string> = {
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
  robotAccount: "Robot account",
  invitation: "Invitation",
  member: "Member",
  organization: "Organization",
};

export const auditLogSearchSchema = z.object({
  resourceType: enumArrayParam(RESOURCE_TYPE_VALUES),
  from: optionalStringParam(),
  to: optionalStringParam(),
});

export type AuditLogSearch = z.infer<typeof auditLogSearchSchema>;

const isResourceType = (value: unknown): value is ResourceTypeValue =>
  (RESOURCE_TYPE_VALUES as readonly unknown[]).includes(value);

// An empty chip selection means "all resources".
const RESOURCE_FILTER_OPTIONS = RESOURCE_TYPE_VALUES.map((value) => ({
  value,
  label: RESOURCE_TYPE_LABELS[value],
}));

const resourceTypeLabel = (value: string): string =>
  isResourceType(value) ? RESOURCE_TYPE_LABELS[value] : value;

// Audit `action` strings are raw tokens (`vault.web.unlock`, `apple.push-key.upload`).
// Most humanize cleanly by de-dotting/de-casing, but a few are jargon or historical,
// so this override map wins first. The pre-rename `vault.web.step-up` maps to the same
// label as its `vault.web.unlock` rename, so old rows read identically with no backfill.
const ACTION_LABELS: Record<string, string> = {
  "vault.web.step-up": "Env vault unlocked (passkey)",
  "vault.web.unlock": "Env vault unlocked (passkey)",
  "envVar.describe": "Env var documentation edited",
};

// Split on dots, dashes, and camelCase boundaries, then sentence-case the whole
// token: `apple.push-key.upload` -> "Apple push key upload", `envVar.bulkImport`
// -> "Env var bulk import". A best-effort fallback for actions without an override.
const humanizeActionToken = (action: string): string => {
  const words = action
    .split(".")
    .flatMap((segment) => segment.split("-"))
    .flatMap((segment) =>
      segment.replaceAll(/(?<lower>[a-z0-9])(?<upper>[A-Z])/gu, "$<lower> $<upper>").split(" "),
    )
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  const [first, ...rest] = words;
  if (!first) {
    return action;
  }
  return [`${first.charAt(0).toUpperCase()}${first.slice(1)}`, ...rest].join(" ");
};

export const actionLabel = (action: string): string =>
  ACTION_LABELS[action] ?? humanizeActionToken(action);

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

// Audit metadata is free-form JSON, but most events stamp a human identifier
// under one of a few well-known keys — surface it so the Resource column shows
// "production" instead of only a UUID.
const readMetadataName = (parsed: unknown): string | undefined => {
  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }
  const { name, message, key, email, slug } = parsed as {
    name?: unknown;
    message?: unknown;
    key?: unknown;
    email?: unknown;
    slug?: unknown;
  };
  return [name, message, key, email, slug].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
};

// Actor identity media (spec §5.9): humans get the shared EntityAvatar seeded
// by email; robot actors get a BotIcon medallion — the `robot:` name prefix
// keeps the state readable as text, so the old "Robot" badge is redundant.
const ActorCell = ({ actorEmail, source }: { actorEmail: string; source: string }) => (
  <span className="flex items-center gap-2">
    {source === "robot" ? (
      <span
        className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full border"
        title="Robot account"
      >
        <BotIcon strokeWidth={2} className="size-3.5" aria-hidden />
      </span>
    ) : (
      <EntityAvatar name={actorEmail} size="sm" />
    )}
    <span className="truncate" title={actorEmail}>
      {actorEmail}
    </span>
  </span>
);

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
  const resourceName = readMetadataName(parsed);

  return (
    <TableRow>
      <TableCell>
        <span className="block max-w-96 truncate font-medium" title={entry.action}>
          {actionLabel(entry.action)}
        </span>
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-0.5">
          <span className="max-w-56 truncate" title={resourceName}>
            {resourceName ?? resourceTypeLabel(entry.resourceType)}
          </span>
          <span className="text-muted-foreground flex items-center gap-1 text-xs">
            {resourceName ? <span>{resourceTypeLabel(entry.resourceType)}</span> : null}
            {entry.resourceId ? (
              <>
                {resourceName ? <span aria-hidden>·</span> : null}
                <code className="max-w-24 truncate font-mono" title={entry.resourceId}>
                  {entry.resourceId.slice(0, 8)}
                </code>
                <CopyButton value={entry.resourceId} label="Resource ID" size="icon-xs" />
              </>
            ) : null}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <ActorCell actorEmail={entry.actorEmail} source={entry.source} />
      </TableCell>
      <TableCell className="text-muted-foreground text-right whitespace-nowrap">
        <span title={`${formatWeekdayShort(entry.createdAt)} ${formatTimeShort(entry.createdAt)}`}>
          {formatRelativeTime(entry.createdAt)}
        </span>
      </TableCell>
      <TableCell className="text-right last:pe-4">
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
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>
          <span className="font-mono text-xs tracking-wider uppercase">{action}</span> metadata
        </DialogTitle>
        <DialogDescription>Raw event payload recorded for this audit entry.</DialogDescription>
      </DialogHeader>
      <pre className="bg-muted/40 max-h-[60vh] overflow-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">
        {JSON.stringify(parsed, null, 2)}
      </pre>
    </DialogContent>
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
    ...(resourceType.length > 0 ? { resourceType } : {}),
    ...(from && to ? { from, to } : {}),
  };

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useSuspenseInfiniteQuery(
    auditLogsInfiniteQueryOptions(orgId, filters),
  );

  const items = data.pages.flatMap((page) => page.items);

  const handleResourceTypeChange = (next: readonly string[]): void => {
    onChangeSearch({ ...search, resourceType: next.filter(isResourceType) });
  };

  const handleDateRangeChange = (range: DateRange | undefined): void => {
    onChangeSearch({
      ...search,
      ...(range?.from ? { from: range.from.toISOString() } : { from: undefined }),
      ...(range?.to ? { to: range.to.toISOString() } : { to: undefined }),
    });
  };

  const isFiltered = resourceType.length > 0 || Boolean(from) || Boolean(to);

  const handleReset = (): void => {
    onChangeSearch({ resourceType: [], from: undefined, to: undefined });
  };

  return (
    <div className="flex w-full flex-col gap-4">
      <DataTableToolbar isFiltered={isFiltered} onReset={handleReset}>
        <DataTableFacetedFilter
          title="Resource"
          options={RESOURCE_FILTER_OPTIONS}
          selected={resourceType}
          onChange={handleResourceTypeChange}
        />
        <DateRangePicker
          value={dateRange}
          onChange={handleDateRangeChange}
          placeholder="Date range"
          triggerVariant="filter"
        />
      </DataTableToolbar>

      {items.length === 0 ? (
        <EmptyState scopeLabel={scopeLabel} />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead className="text-right">When</TableHead>
                  <TableHead className="w-16 pe-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((entry) => (
                  <AuditLogRow key={entry.id} entry={entry} />
                ))}
              </TableBody>
            </Table>
          </div>
          {hasNextPage ? (
            <div className="flex justify-center">
              <Button
                variant="outline"
                disabled={isFetchingNextPage}
                onClick={async () => {
                  await fetchNextPage();
                }}
              >
                {isFetchingNextPage && <Spinner data-icon="inline-start" />}
                Load more
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};
