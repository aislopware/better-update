import {
  buildCompatibilityMatrixQueryOptions,
  buildQueryOptions,
} from "@better-update/api-client/react";
import { safeJsonParse } from "@better-update/safe-json";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";

import type { BuildWithArtifact } from "@better-update/api";

import { BuildCard } from "../-build-card";
import { FORMAT_LABELS, formatBytes } from "../-build-helpers";
import { synthesizeBuildChannels } from "../-compatibility-join";
import { InstallLinkDialog } from "../-install-link-dialog";
import { ProjectSubpageHeader } from "../-project-subpage-header";
import { DetailCardSkeleton, SummaryCardsSkeleton } from "../../../../../../components/skeletons";

import type { BuildWithSyntheticChannels } from "../-compatibility-join";

const formatMetadataJson = (metadataJson: string) => {
  const parsed = safeJsonParse(metadataJson);
  return parsed === null ? metadataJson : JSON.stringify(parsed, null, 2);
};

const BuildMetadataCard = ({ build }: { build: typeof BuildWithArtifact.Type }) => (
  <Card>
    <CardHeader>
      <CardTitle>Build metadata</CardTitle>
      <CardDescription>
        Core fields used for install, compatibility, and traceability.
      </CardDescription>
    </CardHeader>
    <CardContent className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1">
        <div className="text-muted-foreground text-sm">Runtime version</div>
        <div className="font-medium">{build.runtimeVersion ?? "Missing"}</div>
      </div>
      <div className="space-y-1">
        <div className="text-muted-foreground text-sm">Bundle ID</div>
        <div className="font-medium">{build.bundleId ?? "Missing"}</div>
      </div>
      <div className="space-y-1">
        <div className="text-muted-foreground text-sm">App version</div>
        <div className="font-medium">{build.appVersion ?? "Missing"}</div>
      </div>
      <div className="space-y-1">
        <div className="text-muted-foreground text-sm">Build number</div>
        <div className="font-medium">{build.buildNumber ?? "Missing"}</div>
      </div>
      <div className="space-y-1">
        <div className="text-muted-foreground text-sm">Git ref</div>
        <div className="font-medium">{build.gitRef ?? "Not provided"}</div>
      </div>
      <div className="space-y-1">
        <div className="text-muted-foreground text-sm">Git commit</div>
        <div className="font-medium">{build.gitCommit ?? "Not provided"}</div>
      </div>
      <div className="space-y-1 sm:col-span-2">
        <div className="text-muted-foreground text-sm">Created</div>
        <div className="font-medium">{new Date(build.createdAt).toLocaleString()}</div>
      </div>
      <div className="space-y-1 sm:col-span-2">
        <div className="text-muted-foreground text-sm">Metadata JSON</div>
        <pre className="bg-muted overflow-x-auto rounded-xl p-3 text-xs">
          {formatMetadataJson(build.metadataJson)}
        </pre>
      </div>
    </CardContent>
  </Card>
);

const ArtifactCard = ({ build }: { build: typeof BuildWithArtifact.Type }) => (
  <Card>
    <CardHeader>
      <CardTitle>Artifact</CardTitle>
      <CardDescription>Download, install, and inspect the uploaded binary.</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      {build.artifact ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{FORMAT_LABELS[build.artifact.format]}</Badge>
            <Badge variant="secondary">{formatBytes(build.artifact.byteSize)}</Badge>
            <Badge variant="outline">{build.artifact.contentType}</Badge>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <div className="text-muted-foreground text-sm">SHA-256</div>
              <code className="block text-xs break-all">{build.artifact.sha256}</code>
            </div>
            <div className="space-y-1">
              <div className="text-muted-foreground text-sm">Storage key</div>
              <code className="block text-xs break-all">{build.artifact.r2Key}</code>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a href={`/api/builds/${build.id}/artifact`}>
              <Button variant="outline">Download artifact</Button>
            </a>
            <InstallLinkDialog
              build={build}
              buttonVariant="outline"
              buttonSize="sm"
              buttonLabel="Install / copy link"
            />
          </div>
        </>
      ) : (
        <p className="text-muted-foreground text-sm">
          No artifact has been finalized for this build yet.
        </p>
      )}
    </CardContent>
  </Card>
);

const RelatedChannelsCard = ({
  projectSlug,
  build,
}: {
  projectSlug: string;
  build: BuildWithSyntheticChannels;
}) => (
  <Card>
    <CardHeader>
      <CardTitle>Compatible channels</CardTitle>
      <CardDescription>
        Open a channel detail page to inspect rollout and update state.
      </CardDescription>
    </CardHeader>
    <CardContent>
      {build.channels.length > 0 ? (
        <div className="flex flex-col gap-3">
          {build.channels.map((channel) => (
            <div
              key={`${build.id}:${channel.channelId}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{channel.channelName}</span>
                {channel.isPaused && <Badge variant="outline">Paused</Badge>}
                {channel.rolloutActive && <Badge variant="secondary">Rollout active</Badge>}
                <span className="text-muted-foreground text-sm">
                  {channel.updateCount > 0
                    ? `${channel.updateCount} matching updates`
                    : "No matching updates"}
                </span>
              </div>
              <Link
                to="/projects/$projectSlug/channels/$channelId"
                params={{ projectSlug, channelId: channel.channelId }}
                className="text-muted-foreground hover:text-foreground text-sm transition-colors"
              >
                Open channel
              </Link>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          No channels currently match this build&apos;s runtime version.
        </p>
      )}
    </CardContent>
  </Card>
);

const BuildNotFoundState = ({ projectSlug }: { projectSlug: string }) => (
  <Card className="border-dashed">
    <CardContent className="flex flex-col gap-3 py-10">
      <div className="text-lg font-medium">Build not found in this project</div>
      <p className="text-muted-foreground text-sm">
        The requested build exists outside this project or was removed.
      </p>
      <div>
        <Link
          to="/projects/$projectSlug"
          params={{ projectSlug }}
          className="text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          Back to project
        </Link>
      </div>
    </CardContent>
  </Card>
);

const BuildDetailContent = () => {
  const { buildId } = Route.useParams();
  const { activeOrg, project } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const projectId = project.id;
  const { data: build } = useSuspenseQuery(buildQueryOptions(orgId, buildId));
  const { data: compatibilityData } = useSuspenseQuery(
    buildCompatibilityMatrixQueryOptions(orgId, projectId),
  );

  const buildWithChannels = synthesizeBuildChannels(build, compatibilityData);

  return (
    <>
      <ProjectSubpageHeader
        title={(build.message ?? build.profile) || `Build ${build.id.slice(0, 8)}`}
      />
      {build.projectId === projectId ? (
        <>
          <BuildCard
            build={buildWithChannels}
            orgId={orgId}
            projectId={projectId}
            projectSlug={project.slug}
            showDetailsLink={false}
          />
          <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <ArtifactCard build={build} />
            <RelatedChannelsCard projectSlug={project.slug} build={buildWithChannels} />
          </div>
          <BuildMetadataCard build={build} />
        </>
      ) : (
        <BuildNotFoundState projectSlug={project.slug} />
      )}
    </>
  );
};

const BuildDetailSkeleton = () => (
  <>
    <ProjectSubpageHeader title="Build" />
    <SummaryCardsSkeleton count={3} />
    <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
      <DetailCardSkeleton rows={3} columns={2} />
      <DetailCardSkeleton rows={2} columns={1} />
    </div>
    <DetailCardSkeleton rows={4} columns={2} />
  </>
);

const BuildDetailPage = () => (
  <div className="flex w-full flex-col gap-4">
    <Suspense fallback={<BuildDetailSkeleton />}>
      <BuildDetailContent />
    </Suspense>
  </div>
);

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/builds/$buildId")({
  component: BuildDetailPage,
});
