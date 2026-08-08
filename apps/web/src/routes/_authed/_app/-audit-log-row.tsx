import { safeJsonParse } from "@better-update/safe-json";
import { Button } from "@better-update/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@better-update/ui/components/dialog";
import { InlineCode } from "@better-update/ui/components/inline-code";
import { TableCell, TableRow } from "@better-update/ui/components/table";
import { BracketsCurlyIcon, RobotIcon } from "@phosphor-icons/react";

import { CopyButton } from "../../../lib/copy-button";
import { PRIMARY_COLUMN_CLASS } from "../../../lib/data-table";
import { EntityAvatar } from "../../../lib/entity-avatar";
import { formatTimeShort, formatWeekdayShort } from "../../../lib/format-date";
import { formatRelativeTime } from "../../../lib/format-relative-time";
import { actionLabel, resourceTypeLabel } from "./-audit-log-labels";
import { AuditResourceLink } from "./-audit-resource-link";

export interface AuditLogEntry {
  readonly id: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly actorEmail: string;
  readonly source: string;
  readonly createdAt: string;
  readonly metadata: string | null;
}

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
  projectSlug,
  resourceType,
  resourceId,
  resourceName,
  action,
}: {
  readonly projectSlug: string | undefined;
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
      <div className="flex min-w-0 flex-col gap-0.5">
        {resourceId ? (
          <span className="flex min-w-0 items-center gap-1">
            <AuditResourceLink
              projectSlug={projectSlug}
              resourceType={resourceType}
              resourceId={resourceId}
              action={action}
              className="min-w-0 truncate"
            >
              <code className="truncate font-mono text-xs" title={resourceId}>
                {resourceId}
              </code>
            </AuditResourceLink>
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
    <div className="flex min-w-0 flex-col gap-0.5">
      <AuditResourceLink
        projectSlug={projectSlug}
        resourceType={resourceType}
        resourceId={resourceId}
        action={action}
        className="min-w-0 truncate"
      >
        <span className="truncate" title={resourceName}>
          {resourceName}
        </span>
      </AuditResourceLink>
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

// Quiet at rest, like the row menus elsewhere: fifty of these down the right
// edge is a column of punctuation if any of them shouts. Braces are what the
// payload looks like and not what it is, so the pointer gets told in words.
const metadataTrigger = (
  <Button
    variant="ghost"
    shape="square"
    size="sm"
    aria-label="View metadata"
    title="View metadata"
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

export const AuditLogRow = ({
  entry,
  projectSlug,
}: {
  readonly entry: AuditLogEntry;
  readonly projectSlug: string | undefined;
}) => {
  const parsed = parseMetadata(entry.metadata);
  const resourceName = readMetadataName(parsed);

  return (
    <TableRow>
      {/* An action is two or three words and never more, so it asks for the
          width of the longest one and stops. It used to claim the table's
          leftover width instead, which put half the page between "Build upload"
          and the thing it was said about. */}
      <TableCell className="whitespace-nowrap">
        <span className="font-medium" title={entry.action}>
          {actionLabel(entry.action)}
        </span>
      </TableCell>
      {/* The resource is the variable-length half of the row — a release
          message, a channel name, an id in full — so the slack goes here. */}
      <TableCell className={PRIMARY_COLUMN_CLASS}>
        <ResourceCell
          projectSlug={projectSlug}
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
