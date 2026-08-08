import { AuditLogResourceType } from "@better-update/api";
import { auditLogsInfiniteQueryOptions } from "@better-update/api-client/react";
import { safeJsonParse } from "@better-update/safe-json";
import { Button } from "@better-update/ui/components/button";
import { DateRangePicker } from "@better-update/ui/components/date-range-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@better-update/ui/components/dialog";
import { Empty } from "@better-update/ui/components/empty";
import { InlineCode } from "@better-update/ui/components/inline-code";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/table";
import { BracketsCurlyIcon, RobotIcon, ScrollIcon } from "@phosphor-icons/react";
import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { z } from "zod";

import type { DateRange } from "react-day-picker";

import { FilterBarSkeleton, TableSkeleton } from "../../../components/skeletons";
import { CopyButton } from "../../../lib/copy-button";
import {
  DataTableFacetedFilter,
  DataTableToolbar,
  enumArrayParam,
  ListPanel,
  ListPanelFooter,
  optionalStringParam,
  PRIMARY_COLUMN_CLASS,
} from "../../../lib/data-table";
import { EntityAvatar } from "../../../lib/entity-avatar";
import { formatTimeShort, formatWeekdayShort } from "../../../lib/format-date";
import { formatRelativeTime } from "../../../lib/format-relative-time";
import { pluralize } from "../../../lib/pluralize";

export const AuditLogSkeleton = () => (
  <div className="flex w-full flex-col gap-4">
    <FilterBarSkeleton selectCount={2} />
    <TableSkeleton columns={5} rows={6} hasFooter={false} />
  </div>
);

// Taken from the contract rather than retyped beside it: the audit-log repository
// filters with `WHERE resource_type = ?`, so every option has to equal a stored
// value, and the hand-kept copy had already drifted — `credentialBinding` was
// missing, so binding events printed their raw token and no chip could find them.
const RESOURCE_TYPE_VALUES = AuditLogResourceType.literals;

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
  credentialBinding: "Credential binding",
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

// Split on dots, dashes, underscores and camelCase boundaries, then sentence-case
// the whole token: `apple.push-key.upload` -> "Apple push key upload",
// `envVar.bulkImport` -> "Env var bulk import". Underscores used to survive the
// split, so `projectMember.all_projects_set` reached the table still wearing one.
const humanizeActionToken = (action: string): string => {
  const words = action
    .split(".")
    .flatMap((segment) => segment.split("-"))
    .flatMap((segment) => segment.split("_"))
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

// A row stored before its type joined the contract still has to read as English,
// so the fallback goes through the same humanizer the actions use rather than
// printing `credentialBinding` at the reader.
const resourceTypeLabel = (value: string): string =>
  isResourceType(value) ? RESOURCE_TYPE_LABELS[value] : humanizeActionToken(value);

// Audit `action` strings are raw tokens (`vault.web.unlock`, `apple.push-key.upload`).
// Most humanize cleanly by de-dotting/de-casing, but a few are jargon or historical,
// so this override map wins first. The pre-rename `vault.web.step-up` maps to the same
// label as its `vault.web.unlock` rename, so old rows read identically with no backfill.
const ACTION_LABELS: Record<string, string> = {
  "vault.web.step-up": "Env vault unlocked (passkey)",
  "vault.web.unlock": "Env vault unlocked (passkey)",
  "envVar.describe": "Env var documentation edited",
  // "Project member all projects set" is what the token says and not what it
  // means: these two grant and revoke one role across every project at once.
  "projectMember.all_projects_set": "Member given a role on all projects",
  "projectMember.all_projects_remove": "Member's all-projects role removed",
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
// by email; robot actors get a RobotIcon medallion — the `robot:` name prefix
// keeps the state readable as text, so the old "Robot" badge is redundant.
const ActorCell = ({ actorEmail, source }: { actorEmail: string; source: string }) => (
  <span className="flex items-center gap-2">
    {source === "robot" ? (
      <span
        className="bg-kumo-tint text-kumo-subtle flex size-6 shrink-0 items-center justify-center rounded-full border"
        title="Robot account"
      >
        <RobotIcon weight="bold" className="size-3.5" aria-hidden />
      </span>
    ) : (
      <EntityAvatar name={actorEmail} size="sm" />
    )}
    <span className="truncate" title={actorEmail}>
      {actorEmail}
    </span>
  </span>
);

/**
 * Which thing the event happened to.
 *
 * Every row used to lead this column with the resource's type — "Build" beside
 * "Build upload", "Update" beside "Update publish" — so the first word of the
 * action was printed twice on the same line and the id it was standing over got
 * eight characters. The column names the thing instead: its name when the event
 * recorded one, otherwise its id in full, with the type kept only where the
 * action does not already say it ("Credential binding" under "Binding revoke").
 */
const ResourceCell = ({
  resourceType,
  resourceId,
  resourceName,
  action,
}: {
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly resourceName: string | undefined;
  readonly action: string;
}) => {
  const typeLabel = resourceTypeLabel(resourceType);
  const typeIsSaidAlready = actionLabel(action).toLowerCase().startsWith(typeLabel.toLowerCase());
  const context = typeIsSaidAlready ? undefined : typeLabel;

  if (!resourceName) {
    return (
      <div className="flex max-w-56 flex-col gap-0.5">
        {resourceId ? (
          <span className="flex items-center gap-1">
            <code className="truncate font-mono text-xs" title={resourceId}>
              {resourceId}
            </code>
            <CopyButton value={resourceId} label="Resource ID" size="xs" />
          </span>
        ) : null}
        {context || !resourceId ? (
          <span className="text-kumo-subtle text-xs">{typeLabel}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex max-w-56 flex-col gap-0.5">
      <span className="truncate" title={resourceName}>
        {resourceName}
      </span>
      <span className="text-kumo-subtle flex items-center gap-1 text-xs">
        {context ? <span>{context}</span> : null}
        {resourceId ? (
          <>
            {context ? <span aria-hidden>·</span> : null}
            <code className="max-w-24 truncate font-mono" title={resourceId}>
              {resourceId.slice(0, 8)}
            </code>
            <CopyButton value={resourceId} label="Resource ID" size="xs" />
          </>
        ) : null}
      </span>
    </div>
  );
};

const EmptyState = ({ scopeLabel }: { scopeLabel: string }) => (
  <Empty
    icon={<ScrollIcon className="text-kumo-inactive size-10" />}
    title="No activity yet"
    description={`Actions performed in ${scopeLabel} will appear here.`}
  />
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
      {/* The action is what the row is: it takes the width the other columns
          leave, rather than capping itself and leaving a gap beside it. */}
      <TableCell className={PRIMARY_COLUMN_CLASS}>
        <span className="block truncate font-medium" title={entry.action}>
          {actionLabel(entry.action)}
        </span>
      </TableCell>
      <TableCell>
        <ResourceCell
          resourceType={entry.resourceType}
          resourceId={entry.resourceId}
          resourceName={resourceName}
          action={entry.action}
        />
      </TableCell>
      <TableCell>
        <ActorCell actorEmail={entry.actorEmail} source={entry.source} />
      </TableCell>
      <TableCell className="text-kumo-subtle text-right whitespace-nowrap">
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

// Quiet at rest, like the row menus elsewhere: it appears on some rows and not
// others, and a filled button in that pattern reads as a ragged extra column.
const metadataTrigger = (
  <Button
    variant="ghost"
    shape="square"
    size="sm"
    aria-label="View metadata"
    className="text-kumo-subtle/70 hover:text-kumo-default"
  >
    <BracketsCurlyIcon weight="bold" />
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
    <DialogContent size="xl">
      <DialogHeader>
        <DialogTitle>
          <InlineCode className="uppercase">{action}</InlineCode> metadata
        </DialogTitle>
        <DialogDescription>Raw event payload recorded for this audit entry.</DialogDescription>
      </DialogHeader>
      <pre className="bg-kumo-tint/40 max-h-[60vh] overflow-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">
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
        <ListPanel>
          {/* Headers never wrap, the same rule the shared list view follows: the
              primary column has already taken the width the others would use. */}
          <Table className="[&_th]:whitespace-nowrap">
            <TableHeader>
              <TableRow>
                <TableHead className={PRIMARY_COLUMN_CLASS}>Action</TableHead>
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
          {/* The closing bar is always there, like every other list: an infinite
              log still owes the reader a count of what it has loaded so far. */}
          <ListPanelFooter>
            <div className="flex w-full items-center justify-between gap-4">
              <span className="text-kumo-subtle text-xs tabular-nums">
                {hasNextPage ? "First " : ""}
                {items.length} {pluralize(items.length, "event")}
              </span>
              {hasNextPage ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    await fetchNextPage();
                  }}
                  loading={isFetchingNextPage}
                >
                  Load more
                </Button>
              ) : null}
            </div>
          </ListPanelFooter>
        </ListPanel>
      )}
    </div>
  );
};
