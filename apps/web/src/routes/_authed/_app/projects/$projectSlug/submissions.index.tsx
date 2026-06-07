import { submissionsQueryOptions } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Card, CardFrame } from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { Skeleton } from "@better-update/ui/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ChevronRightIcon, UploadCloudIcon } from "lucide-react";
import { Suspense } from "react";

import type { SubmissionItem, SubmissionStatusValue } from "@better-update/api-client/react";

import { formatDateTime } from "../../../../../lib/format-date";
import { ProjectSubpageHeader } from "./-project-subpage-header";

const STATUS_VARIANT: Record<SubmissionStatusValue, "secondary" | "destructive" | "outline"> = {
  AWAITING_BUILD: "outline",
  IN_QUEUE: "outline",
  IN_PROGRESS: "secondary",
  FINISHED: "secondary",
  ERRORED: "destructive",
  CANCELED: "outline",
};

const STATUS_LABEL: Record<SubmissionStatusValue, string> = {
  AWAITING_BUILD: "Awaiting build",
  IN_QUEUE: "In queue",
  IN_PROGRESS: "In progress",
  FINISHED: "Finished",
  ERRORED: "Errored",
  CANCELED: "Canceled",
};

const ROW_CLASS =
  "hover:bg-muted/50 flex items-center justify-between gap-2 px-3 py-3 text-sm transition-colors";

const SubmissionsEmpty = () => (
  <Card>
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <UploadCloudIcon strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>No submissions yet</EmptyTitle>
        <EmptyDescription>
          Use the CLI `better-update submit` to push a build to App Store Connect or Google Play.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  </Card>
);

const SubmissionRow = ({
  projectSlug,
  submission,
}: {
  readonly projectSlug: string;
  readonly submission: SubmissionItem;
}) => (
  <TableRow>
    <TableCell className="p-0">
      <Link
        to="/projects/$projectSlug/submissions/$submissionId"
        params={{ projectSlug, submissionId: submission.id }}
        className={ROW_CLASS}
      >
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_VARIANT[submission.status]}>
              {STATUS_LABEL[submission.status]}
            </Badge>
            <span className="font-mono text-xs uppercase">{submission.platform}</span>
            <span className="text-muted-foreground">{submission.profileName}</span>
            <span className="text-muted-foreground/70 text-xs">via {submission.archiveSource}</span>
            {submission.buildId ? (
              <span className="text-muted-foreground/70 font-mono text-xs">
                build {submission.buildId.slice(0, 8)}
              </span>
            ) : null}
          </span>
          {submission.status === "ERRORED" && submission.errorMessage ? (
            <span className="text-destructive truncate text-xs">{submission.errorMessage}</span>
          ) : null}
        </span>
        <span className="flex items-center gap-3">
          <span className="text-muted-foreground text-xs">
            {formatDateTime(submission.createdAt)}
          </span>
          <ChevronRightIcon strokeWidth={2} className="text-muted-foreground size-4" />
        </span>
      </Link>
    </TableCell>
  </TableRow>
);

const SubmissionsSection = ({
  orgId,
  projectId,
  projectSlug,
}: {
  readonly orgId: string;
  readonly projectId: string;
  readonly projectSlug: string;
}) => {
  const { data } = useSuspenseQuery(submissionsQueryOptions(orgId, projectId));
  const { items } = data;

  if (items.length === 0) {
    return (
      <div className="flex w-full flex-col gap-4">
        <ProjectSubpageHeader title="Submissions" />
        <SubmissionsEmpty />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <ProjectSubpageHeader title="Submissions" />
      <CardFrame>
        <Table variant="card">
          <TableHeader>
            <TableRow>
              <TableHead>Submission</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((submission) => (
              <SubmissionRow
                key={submission.id}
                projectSlug={projectSlug}
                submission={submission}
              />
            ))}
          </TableBody>
        </Table>
      </CardFrame>
    </div>
  );
};

const SubmissionsSkeleton = () => (
  <CardFrame>
    <Table variant="card">
      <TableBody>
        {[0, 1, 2].map((index) => (
          <TableRow key={index}>
            <TableCell>
              <Skeleton className="h-4 w-64 rounded" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </CardFrame>
);

const SubmissionsPage = () => {
  const { activeOrg, project } = Route.useRouteContext();
  const { projectSlug } = Route.useParams();
  return (
    <Suspense fallback={<SubmissionsSkeleton />}>
      <SubmissionsSection orgId={activeOrg.id} projectId={project.id} projectSlug={projectSlug} />
    </Suspense>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/submissions/")({
  component: SubmissionsPage,
});
