import { Badge } from "@better-update/ui/components/badge";
import { cn } from "@better-update/ui/lib/utils";
import { CaretRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

import type { Update } from "@better-update/api";

import { PlatformIndicator } from "../../../../../components/attribute-badges";
import { ListPanel, ListPanelFooter, ListPanelHeader } from "../../../../../lib/data-table";
import { pluralize } from "../../../../../lib/pluralize";
import { RelativeTime } from "../../../../../lib/relative-time";
import { ROW_LINK_DIVIDED } from "../../../../../lib/row-link";

/** Enough to read the shape of what this channel is serving, not a second list. */
export const VISIBLE_UPDATE_LIMIT = 6;

/**
 * A rollout percentage is a fact only while it is short of everyone: every
 * finished update carries 100 and a column of them says nothing.
 */
const RolloutShare = ({ percentage }: { percentage: number }) =>
  percentage >= 100 ? null : (
    <span className="shrink-0 text-xs tabular-nums">{percentage}% of clients</span>
  );

const ChannelUpdateRow = ({ projectSlug, update }: { projectSlug: string; update: Update }) => (
  <Link
    to="/projects/$projectSlug/updates/$updateId"
    params={{ projectSlug, updateId: update.id }}
    className={cn(ROW_LINK_DIVIDED, "group/row flex items-start justify-between gap-3 px-4 py-3")}
  >
    <span className="flex min-w-0 flex-col gap-1">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-medium">{update.message || "—"}</span>
        {update.isRollback ? <Badge variant="error">Rollback</Badge> : null}
      </span>
      <span className="text-kumo-subtle flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <PlatformIndicator platform={update.platform} className="gap-1" />
        <span className="font-mono">v{update.runtimeVersion}</span>
        {update.gitCommit ? (
          <span className="font-mono">{update.gitCommit.slice(0, 7)}</span>
        ) : null}
        <RelativeTime value={update.createdAt} />
      </span>
    </span>
    <span className="flex shrink-0 items-center gap-2">
      <RolloutShare percentage={update.rolloutPercentage} />
      <CaretRightIcon
        aria-hidden
        weight="bold"
        className="text-kumo-subtle size-4 opacity-0 transition-opacity duration-(--duration-quick) group-focus-within/row:opacity-100 group-hover/row:opacity-100"
      />
    </span>
  </Link>
);

/**
 * What the channel is actually handing out.
 *
 * The page said which branch the channel points at and which builds could
 * install from it, and then stopped — the reader's first question, what has
 * shipped here lately, needed a trip to the Updates list and a filter rebuilt
 * by hand. These are the newest updates on the linked branch, which is the same
 * set a client on this channel is choosing from.
 */
export const ChannelUpdatesCard = ({
  projectSlug,
  branchId,
  updates,
  totalCount,
}: {
  projectSlug: string;
  branchId: string;
  updates: readonly Update[];
  totalCount: number;
}) => {
  const visible = updates.slice(0, VISIBLE_UPDATE_LIMIT);
  const hiddenCount = Math.max(0, totalCount - visible.length);

  return (
    <ListPanel>
      <ListPanelHeader title="Recent updates" />
      {visible.length > 0 ? (
        visible.map((update) => (
          <ChannelUpdateRow key={update.id} projectSlug={projectSlug} update={update} />
        ))
      ) : (
        <ListPanelFooter>
          <span className="text-kumo-subtle text-sm">
            Nothing published to this branch yet, so this channel has nothing to serve.
          </span>
        </ListPanelFooter>
      )}
      {visible.length > 0 ? (
        <ListPanelFooter>
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <span className="text-kumo-subtle text-sm tabular-nums">
              Showing {visible.length} of {totalCount} {pluralize(totalCount, "update")}
            </span>
            {hiddenCount > 0 ? (
              <Link
                to="/projects/$projectSlug/updates"
                params={{ projectSlug }}
                search={{ page: 1, sort: "-createdAt" as const, branchId: [branchId] }}
                className="text-kumo-subtle hover:text-kumo-default text-sm"
              >
                View all updates →
              </Link>
            ) : null}
          </div>
        </ListPanelFooter>
      ) : null}
    </ListPanel>
  );
};
