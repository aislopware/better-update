import { submissionQueryOptions } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/card";
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
import { DetailCardSkeleton } from "../../../../../components/skeletons";
import { CopyButton, CopyableId } from "../../../../../lib/copy-button";
import { formatDateTime } from "../../../../../lib/format-date";
import { RelativeTime } from "../../../../../lib/relative-time";
import { readSubmissionDestination } from "./-submissions-columns";

const DetailRow = ({
  label,
  value,
  copyLabel,
}: {
  label: string;
  value: string | null | undefined;
  copyLabel?: string;
}) => (
  <div className="flex items-baseline gap-3 text-sm">
    <span className="text-kumo-subtle w-40 shrink-0">{label}</span>
    {value === null || value === undefined || value === "" ? (
      <span className="font-mono break-all">—</span>
    ) : (
      <span className="inline-flex min-w-0 items-center gap-1">
        <span className="min-w-0 font-mono break-all">{value}</span>
        {copyLabel ? <CopyButton value={value} label={copyLabel} /> : null}
      </span>
    )}
  </div>
);

/**
 * The build the archive came from, as somewhere to go. The list used to carry a
 * "View build" link in every row; the path belongs here, once, next to the id
 * it stands for.
 */
const BuildIdRow = ({ buildId, projectSlug }: { buildId: string | null; projectSlug: string }) =>
  buildId === null ? (
    <DetailRow label="Build" value={null} />
  ) : (
    <div className="flex items-baseline gap-3 text-sm">
      <span className="text-kumo-subtle w-40 shrink-0">Build</span>
      <span className="inline-flex min-w-0 items-center gap-1">
        <Link
          to="/projects/$projectSlug/builds/$buildId"
          params={{ projectSlug, buildId }}
          className="min-w-0 font-mono break-all underline-offset-4 hover:underline"
        >
          {buildId}
        </Link>
        <CopyButton value={buildId} label="Build ID" />
      </span>
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
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5">
            {destination?.target ?? "Submission"}
            {destination?.halted ? <Badge variant="warning">Halted</Badge> : null}
          </CardTitle>
          <CardDescription>
            {destination?.detail ?? `Uploaded ${formatDateTime(submission.createdAt)}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          {/* Where the archive came from, said only when it is not the ordinary
              case: nearly every submission starts from a build this project
              already has, and the build row below names it. */}
          {submission.archiveSource === "build" ? null : (
            <DetailRow label="Archive source" value={submission.archiveSource} />
          )}
          <BuildIdRow buildId={submission.buildId} projectSlug={projectSlug} />
          {submission.archiveUrl ? (
            <DetailRow label="Archive URL" value={submission.archiveUrl} copyLabel="Archive URL" />
          ) : null}
          {submission.iosConfig ? (
            <>
              <DetailRow
                label="Bundle identifier"
                value={submission.iosConfig.bundleIdentifier}
                copyLabel="Bundle identifier"
              />
              <DetailRow
                label="ASC App ID"
                value={submission.iosConfig.ascAppId}
                copyLabel="ASC App ID"
              />
              <DetailRow
                label="Apple team"
                value={submission.iosConfig.appleTeamId}
                copyLabel="Apple team"
              />
              <DetailRow label="Language" value={submission.iosConfig.language} />
              <DetailRow label="What to test" value={submission.iosConfig.whatToTest} />
            </>
          ) : null}
          {submission.androidConfig ? (
            <>
              <DetailRow
                label="Application ID"
                value={submission.androidConfig.applicationId}
                copyLabel="Application ID"
              />
              {/* Track, rollout and release status are what the card is titled
                  and described by — repeating them here is the header again. */}
              <DetailRow
                label="Changes not sent for review"
                value={String(submission.androidConfig.changesNotSentForReview)}
              />
            </>
          ) : null}
        </CardContent>
      </Card>
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
    <DetailCardSkeleton rows={6} columns={1} />
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
