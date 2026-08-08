import { submissionQueryOptions } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/badge";
import { InlineCode } from "@better-update/ui/components/inline-code";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";

import type { SubmissionItem } from "@better-update/api-client/react";

import {
  PlatformIndicator,
  SubmissionMetadataBadge,
} from "../../../../../components/attribute-badges";
import { DetailHeader } from "../../../../../components/detail-header";
import { DetailStat, DetailStatStrip } from "../../../../../components/detail-stats";
import { DetailCardSkeleton } from "../../../../../components/skeletons";
import { CopyButton, CopyableId } from "../../../../../lib/copy-button";
import { ListPanel, ListPanelHeader } from "../../../../../lib/data-table";
import { formatDateTime } from "../../../../../lib/format-date";
import { RelativeTime } from "../../../../../lib/relative-time";
import { readSubmissionDestination } from "./-submissions-columns";

// A submission's fields used to be a stack of label-in-a-40-width-column rows,
// which put every value in the left third of a full-width card and left the rest
// of the page blank. They are short facts, so they read across.
const DetailField = ({
  label,
  value,
  copyLabel,
}: {
  label: string;
  value: string | null | undefined;
  copyLabel?: string;
}) => (
  <DetailStat label={label}>
    {value === null || value === undefined || value === "" ? (
      <span className="text-kumo-subtle">—</span>
    ) : (
      <>
        <span className="truncate font-mono text-xs" title={value}>
          {value}
        </span>
        {copyLabel ? <CopyButton value={value} label={copyLabel} /> : null}
      </>
    )}
  </DetailStat>
);

/**
 * The build the archive came from, as somewhere to go. The list used to carry a
 * "View build" link in every row; the path belongs here, once, next to the id
 * it stands for.
 */
const BuildIdField = ({ buildId, projectSlug }: { buildId: string | null; projectSlug: string }) =>
  buildId === null ? (
    <DetailField label="Build" value={null} />
  ) : (
    <DetailStat label="Build">
      <Link
        to="/projects/$projectSlug/builds/$buildId"
        params={{ projectSlug, buildId }}
        className="truncate font-mono text-xs underline-offset-4 hover:underline"
        title={buildId}
      >
        {buildId}
      </Link>
      <CopyButton value={buildId} label="Build ID" />
    </DetailStat>
  );

/** A field whose value is a sentence rather than an identifier. */
const DetailProse = ({ label, value }: { label: string; value: string }) => (
  <div className="border-kumo-line flex flex-col gap-1 border-t p-4">
    <span className="text-kumo-subtle text-xs">{label}</span>
    <p className="text-sm">{value}</p>
  </div>
);

const SubmissionDetail = ({
  submission,
  projectSlug,
}: {
  submission: SubmissionItem;
  projectSlug: string;
}) => {
  const destination = readSubmissionDestination(submission);
  return (
    <>
      <DetailHeader
        // A page called "Submission" told you only which page you were on. The
        // build number is what the list names the row, so it is what the row
        // opens into.
        title={submission.buildVersion ? `Build #${submission.buildVersion}` : "Submission"}
        badges={
          submission.metadataComplete ? null : (
            <span className="text-base font-normal">
              <SubmissionMetadataBadge complete={false} />
            </span>
          )
        }
        meta={
          <>
            <CopyableId value={submission.id} label="Submission ID" />
            <PlatformIndicator platform={submission.platform} />
            <span>
              Profile <InlineCode>{submission.profileName}</InlineCode>
            </span>
            <span>
              Created <RelativeTime value={submission.createdAt} />
            </span>
          </>
        }
      />
      <ListPanel>
        <ListPanelHeader
          title={
            <span className="flex items-center gap-2.5">
              {destination?.target ?? "Submission"}
              {destination?.halted ? <Badge variant="warning">Halted</Badge> : null}
            </span>
          }
          description={destination?.detail ?? `Uploaded ${formatDateTime(submission.createdAt)}`}
        />
        <DetailStatStrip columns={3}>
          {/* Where the archive came from, said only when it is not the ordinary
              case: nearly every submission starts from a build this project
              already has, and the build field beside it names that build. */}
          {submission.archiveSource === "build" ? null : (
            <DetailField label="Archive source" value={submission.archiveSource} />
          )}
          <BuildIdField buildId={submission.buildId} projectSlug={projectSlug} />
          {submission.archiveUrl ? (
            <DetailField
              label="Archive URL"
              value={submission.archiveUrl}
              copyLabel="Archive URL"
            />
          ) : null}
          {submission.iosConfig ? (
            <>
              <DetailField
                label="Bundle identifier"
                value={submission.iosConfig.bundleIdentifier}
                copyLabel="Bundle identifier"
              />
              <DetailField
                label="ASC App ID"
                value={submission.iosConfig.ascAppId}
                copyLabel="ASC App ID"
              />
              <DetailField
                label="Apple team"
                value={submission.iosConfig.appleTeamId}
                copyLabel="Apple team"
              />
              <DetailField label="Language" value={submission.iosConfig.language} />
            </>
          ) : null}
          {submission.androidConfig ? (
            <>
              <DetailField
                label="Application ID"
                value={submission.androidConfig.applicationId}
                copyLabel="Application ID"
              />
              {/* Track, rollout and release status are what the panel is titled
                  and described by — repeating them here is the header again. */}
              <DetailStat label="Changes sent for review">
                {submission.androidConfig.changesNotSentForReview ? "No" : "Yes"}
              </DetailStat>
            </>
          ) : null}
        </DetailStatStrip>
        {/* Release notes are a sentence, not an identifier, so they get the
            width a sentence needs rather than a third of a strip. */}
        {submission.iosConfig?.whatToTest ? (
          <DetailProse label="What to test" value={submission.iosConfig.whatToTest} />
        ) : null}
      </ListPanel>
    </>
  );
};

const SubmissionDetailContainer = ({
  orgId,
  submissionId,
  projectSlug,
}: {
  readonly orgId: string;
  readonly submissionId: string;
  readonly projectSlug: string;
}) => {
  const { data } = useSuspenseQuery(submissionQueryOptions(orgId, submissionId));
  return <SubmissionDetail submission={data} projectSlug={projectSlug} />;
};

const SubmissionDetailSkeleton = () => (
  <>
    <DetailHeader title="Submission" />
    <DetailCardSkeleton rows={2} columns={3} />
  </>
);

const SubmissionDetailPage = () => {
  const { activeOrg } = Route.useRouteContext();
  const { submissionId, projectSlug } = Route.useParams();
  return (
    <div className="flex w-full flex-col gap-4">
      <Suspense fallback={<SubmissionDetailSkeleton />}>
        <SubmissionDetailContainer
          orgId={activeOrg.id}
          submissionId={submissionId}
          projectSlug={projectSlug}
        />
      </Suspense>
    </div>
  );
};

export const Route = createFileRoute(
  "/_authed/_app/projects/$projectSlug/submissions/$submissionId",
)({
  component: SubmissionDetailPage,
});
