import { submissionQueryOptions } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import {
  CardFrame,
  CardFrameDescription,
  CardFrameHeader,
  CardFrameTitle,
} from "@better-update/ui/components/ui/card";
import { Skeleton } from "@better-update/ui/components/ui/skeleton";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";

import type { SubmissionItem, SubmissionStatusValue } from "@better-update/api-client/react";

const STATUS_VARIANT: Record<SubmissionStatusValue, "secondary" | "destructive" | "outline"> = {
  AWAITING_BUILD: "outline",
  IN_QUEUE: "outline",
  IN_PROGRESS: "secondary",
  FINISHED: "secondary",
  ERRORED: "destructive",
  CANCELED: "outline",
};

const DetailRow = ({ label, value }: { label: string; value: string | null | undefined }) => (
  <div className="flex items-baseline gap-3 text-sm">
    <span className="text-muted-foreground w-40">{label}</span>
    <span className="font-mono break-all">{value ?? "—"}</span>
  </div>
);

const SubmissionDetail = ({
  submission,
  projectSlug,
}: {
  submission: SubmissionItem;
  projectSlug: string;
}) => (
  <div className="flex flex-col gap-4">
    <div className="flex flex-col gap-1.5">
      <Link
        to="/projects/$projectSlug/submissions"
        params={{ projectSlug }}
        className="text-muted-foreground hover:text-foreground text-sm"
      >
        ← Back to submissions
      </Link>
      <h1 className="font-mono text-lg break-all">{submission.id}</h1>
    </div>
    <CardFrame>
      <CardFrameHeader className="py-5">
        <CardFrameTitle className="flex items-center gap-2.5 text-base">
          <Badge variant={STATUS_VARIANT[submission.status]}>{submission.status}</Badge>
          <span className="font-mono text-xs uppercase">{submission.platform}</span>
        </CardFrameTitle>
        <CardFrameDescription>
          Profile <span className="font-mono">{submission.profileName}</span> · created{" "}
          {new Date(submission.createdAt).toLocaleString()}
        </CardFrameDescription>
      </CardFrameHeader>
      <div className="flex flex-col gap-1.5 px-6 pb-5">
        <DetailRow label="Archive source" value={submission.archiveSource} />
        <DetailRow label="Build ID" value={submission.buildId} />
        <DetailRow label="Archive URL" value={submission.archiveUrl} />
        <DetailRow label="Queued at" value={submission.queuedAt} />
        <DetailRow label="Started at" value={submission.startedAt} />
        <DetailRow label="Completed at" value={submission.completedAt} />
        {submission.errorCode === null ? null : (
          <>
            <DetailRow label="Error code" value={submission.errorCode} />
            <DetailRow label="Error message" value={submission.errorMessage} />
          </>
        )}
        {submission.iosConfig === null ? null : (
          <>
            <h2 className="text-muted-foreground mt-3 text-xs uppercase">iOS config</h2>
            <DetailRow label="Bundle identifier" value={submission.iosConfig.bundleIdentifier} />
            <DetailRow label="ASC App ID" value={submission.iosConfig.ascAppId} />
            <DetailRow label="Apple team" value={submission.iosConfig.appleTeamId} />
            <DetailRow label="Language" value={submission.iosConfig.language} />
            <DetailRow label="What to test" value={submission.iosConfig.whatToTest} />
          </>
        )}
        {submission.androidConfig === null ? null : (
          <>
            <h2 className="text-muted-foreground mt-3 text-xs uppercase">Android config</h2>
            <DetailRow label="Application ID" value={submission.androidConfig.applicationId} />
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
        )}
      </div>
    </CardFrame>
  </div>
);

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

const SubmissionDetailSkeleton = () => <Skeleton className="h-64 w-full rounded" />;

const SubmissionDetailPage = () => {
  const { activeOrg } = Route.useRouteContext();
  const { submissionId, projectSlug } = Route.useParams();
  return (
    <Suspense fallback={<SubmissionDetailSkeleton />}>
      <SubmissionDetailContainer
        orgId={activeOrg.id}
        submissionId={submissionId}
        projectSlug={projectSlug}
      />
    </Suspense>
  );
};

export const Route = createFileRoute(
  "/_authed/_app/projects/$projectSlug/submissions/$submissionId",
)({
  component: SubmissionDetailPage,
});
