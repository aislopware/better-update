import { submissionQueryOptions } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import {
  Card,
  CardFrame,
  CardFrameDescription,
  CardFrameHeader,
  CardFrameTitle,
  CardPanel,
} from "@better-update/ui/components/ui/card";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";

import type { SubmissionItem } from "@better-update/api-client/react";

import { PlatformBadge } from "../../../../../components/attribute-badges";
import { DetailCardSkeleton } from "../../../../../components/skeletons";
import { CopyButton, CopyableId } from "../../../../../lib/copy-button";
import { formatDateTime } from "../../../../../lib/format-date";
import {
  SUBMISSION_STATUS_LABEL,
  SUBMISSION_STATUS_VARIANT,
} from "../../../../../lib/submission-status";
import { ProjectSubpageHeader } from "./-project-subpage-header";

const formatTimestamp = (value: string | null | undefined) =>
  value ? formatDateTime(value) : null;

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
    <span className="text-muted-foreground w-40 shrink-0">{label}</span>
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

const SubmissionDetail = ({ submission }: { submission: SubmissionItem }) => (
  <>
    <div className="flex flex-wrap items-center gap-2">
      <ProjectSubpageHeader title="Submission" />
      <CopyableId value={submission.id} label="Submission ID" />
    </div>
    <CardFrame>
      <CardFrameHeader className="py-5">
        <CardFrameTitle className="flex items-center gap-2.5 text-base">
          <Badge variant={SUBMISSION_STATUS_VARIANT[submission.status]}>
            {SUBMISSION_STATUS_LABEL[submission.status]}
          </Badge>
          <PlatformBadge platform={submission.platform} />
        </CardFrameTitle>
        <CardFrameDescription>
          Profile <span className="font-mono">{submission.profileName}</span> · created{" "}
          {formatDateTime(submission.createdAt)}
        </CardFrameDescription>
      </CardFrameHeader>
      <Card>
        <CardPanel className="flex flex-col gap-1.5">
          <DetailRow label="Archive source" value={submission.archiveSource} />
          <DetailRow label="Build ID" value={submission.buildId} copyLabel="Build ID" />
          <DetailRow label="Archive URL" value={submission.archiveUrl} copyLabel="Archive URL" />
          <DetailRow label="Queued at" value={formatTimestamp(submission.queuedAt)} />
          <DetailRow label="Started at" value={formatTimestamp(submission.startedAt)} />
          <DetailRow label="Completed at" value={formatTimestamp(submission.completedAt)} />
          {submission.errorCode ? (
            <>
              <DetailRow label="Error code" value={submission.errorCode} />
              <DetailRow label="Error message" value={submission.errorMessage} />
            </>
          ) : null}
          {submission.iosConfig ? (
            <>
              <h2 className="text-muted-foreground mt-3 text-xs uppercase">iOS config</h2>
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
              <h2 className="text-muted-foreground mt-3 text-xs uppercase">Android config</h2>
              <DetailRow
                label="Application ID"
                value={submission.androidConfig.applicationId}
                copyLabel="Application ID"
              />
              <DetailRow label="Track" value={submission.androidConfig.track} />
              <DetailRow label="Release status" value={submission.androidConfig.releaseStatus} />
              <DetailRow
                label="Rollout"
                value={
                  submission.androidConfig.rollout === null
                    ? null
                    : String(submission.androidConfig.rollout)
                }
              />
              <DetailRow
                label="Changes not sent for review"
                value={String(submission.androidConfig.changesNotSentForReview)}
              />
            </>
          ) : null}
        </CardPanel>
      </Card>
    </CardFrame>
  </>
);

const SubmissionDetailContainer = ({
  orgId,
  submissionId,
}: {
  readonly orgId: string;
  readonly submissionId: string;
}) => {
  const { data } = useSuspenseQuery(submissionQueryOptions(orgId, submissionId));
  return <SubmissionDetail submission={data} />;
};

const SubmissionDetailSkeleton = () => (
  <>
    <ProjectSubpageHeader title="Submission" />
    <DetailCardSkeleton rows={6} columns={1} />
  </>
);

const SubmissionDetailPage = () => {
  const { activeOrg } = Route.useRouteContext();
  const { submissionId } = Route.useParams();
  return (
    <div className="flex w-full flex-col gap-4">
      <Suspense fallback={<SubmissionDetailSkeleton />}>
        <SubmissionDetailContainer orgId={activeOrg.id} submissionId={submissionId} />
      </Suspense>
    </div>
  );
};

export const Route = createFileRoute(
  "/_authed/_app/projects/$projectSlug/submissions/$submissionId",
)({
  component: SubmissionDetailPage,
});
