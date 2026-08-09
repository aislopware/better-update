import { Badge } from "@better-update/ui/components/badge";

import type { SubmissionItem } from "@better-update/api-client/react";

import { PlatformGlyph } from "../../../../../components/attribute-badges";
import { RelativeTime } from "../../../../../lib/relative-time";

import type { DataTableColumnDef } from "../../../../../lib/data-table";

const PERCENT = 100;

/**
 * Where the archive came from, said only when it is not the ordinary case: all
 * but a handful of submissions start from a build this project already has, so
 * a column of "Uploaded build" told a reader nothing they came for.
 */
const ARCHIVE_SOURCE_LABELS: Partial<Record<SubmissionItem["archiveSource"], string>> = {
  path: "Local archive",
  url: "Archive URL",
};

export interface SubmissionDestination {
  /** The store-side surface the build landed on. */
  readonly target: string;
  /** Which slice of it — testing groups, or the track and its rollout. */
  readonly detail: string | null;
  /** Play only: the release was stopped part-way and is serving nobody new. */
  readonly halted: boolean;
}

/**
 * A submission is only interesting for where it went, and both platforms record
 * that in their own config. The row used to carry the archive source instead,
 * which is a fact about this side of the upload rather than the store's.
 */
export const readSubmissionDestination = (
  submission: SubmissionItem,
): SubmissionDestination | null => {
  if (submission.iosConfig) {
    const { groups } = submission.iosConfig;
    return groups.length > 0
      ? { target: "TestFlight", detail: groups.join(", "), halted: false }
      : { target: "App Store Connect", detail: null, halted: false };
  }
  if (submission.androidConfig) {
    const { track, rollout, releaseStatus } = submission.androidConfig;
    return {
      target: "Play Console",
      detail: rollout === null ? track : `${track} · ${Math.round(rollout * PERCENT)}% rollout`,
      halted: releaseStatus === "halted",
    };
  }
  return null;
};

// The build number leads and the profile follows: a project submits from one or
// two profiles, so a column of "production" tells nobody which row is which,
// while the number it shipped does. Pending metadata rides along here rather
// than in a column of its own — it is the exception on a handful of rows, and a
// column whose every other cell reads "Complete" is a column of filler.
//
// No column claims the table's leftover width: a build number is a short thing
// to say, and handing it half the page only moved the whitespace into one
// column instead of spreading it between them.
const SubmissionCell = ({ submission }: { submission: SubmissionItem }) => {
  // Without a build number the profile is already the row's title, and printing
  // it again underneath is the cell talking to itself. (It still shows against a
  // Play track of the same name: a profile and a track are two facts that happen
  // to share a word, and dropping one of them costs the reader the other.)
  const namesItself = submission.buildVersion === null;
  const subtitle = [
    namesItself ? undefined : submission.profileName,
    ARCHIVE_SOURCE_LABELS[submission.archiveSource],
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-medium">
          {submission.buildVersion === null
            ? submission.profileName
            : `Build ${submission.buildVersion}`}
        </span>
        {submission.metadataComplete ? null : <Badge variant="warning">Metadata pending</Badge>}
      </div>
      {subtitle ? (
        <span className="text-kumo-subtle truncate font-mono text-xs">{subtitle}</span>
      ) : null}
    </div>
  );
};

const DestinationCell = ({ submission }: { submission: SubmissionItem }) => {
  const destination = readSubmissionDestination(submission);
  if (destination === null) {
    return <span className="text-kumo-subtle">—</span>;
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <PlatformGlyph platform={submission.platform} />
      <span className="truncate">{destination.target}</span>
      {destination.detail ? (
        <span className="text-kumo-subtle truncate">· {destination.detail}</span>
      ) : null}
      {destination.halted ? <Badge variant="warning">Halted</Badge> : null}
    </span>
  );
};

export const submissionColumns: readonly DataTableColumnDef<SubmissionItem>[] = [
  {
    id: "profile",
    header: "Submission",
    cell: ({ row }) => <SubmissionCell submission={row.original} />,
    enableSorting: false,
  },
  // No platform column: TestFlight and App Store Connect are iOS and the Play
  // Console is Android, so it said in words what the next column said in names.
  // The glyph moved into that column and the width it held went with it.
  {
    id: "destination",
    header: "Destination",
    cell: ({ row }) => <DestinationCell submission={row.original} />,
    enableSorting: false,
  },
  {
    id: "createdAt",
    header: "Created",
    cell: ({ row }) => <RelativeTime value={row.original.createdAt} />,
    enableSorting: false,
    meta: { align: "right", muted: true },
  },
];
