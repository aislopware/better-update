import {
  buildCompatibilityMatrixQueryOptions,
  buildDebugArtifactsQueryOptions,
  buildQueryOptions,
  fetchDebugArtifactDownload,
} from "@better-update/api-client/react";
import { safeJsonParse } from "@better-update/safe-json";
import { Badge } from "@better-update/ui/components/badge";
import { Button, buttonVariants } from "@better-update/ui/components/button";
import { cn } from "@better-update/ui/lib/utils";
import { CaretRightIcon, PackageIcon } from "@phosphor-icons/react";
import { useSuspenseQueries } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";

import type { BuildDebugArtifact, BuildWithArtifact } from "@better-update/api";

import { FORMAT_LABELS, formatBytes } from "../-build-helpers";
import { synthesizeBuildChannels } from "../-compatibility-join";
import { DeleteBuildDialog } from "../-delete-build-dialog";
import { InstallLinkDialog } from "../-install-link-dialog";
import {
  ChannelBadge,
  DistributionIndicator,
  PlatformIndicator,
} from "../../../../../../components/attribute-badges";
import { DetailHeader, DetailNotFound } from "../../../../../../components/detail-header";
import { DetailStat, DetailStatStrip } from "../../../../../../components/detail-stats";
import { DetailCardSkeleton } from "../../../../../../components/skeletons";
import { CopyButton, CopyableId } from "../../../../../../lib/copy-button";
import {
  ClientPaginationBar,
  ListPanel,
  ListPanelFooter,
  ListPanelHeader,
  useClientPagination,
} from "../../../../../../lib/data-table";
import { pluralize } from "../../../../../../lib/pluralize";
import { RelativeTime } from "../../../../../../lib/relative-time";
import { RouterLink } from "../../../../../../lib/resource-link";
import { RouterLinkButton } from "../../../../../../lib/router-link-button";
import { ROW_LINK_DIVIDED } from "../../../../../../lib/row-link";
import { useApiMutation } from "../../../../../../lib/use-api-mutation";

import type { BuildWithSyntheticChannels, SyntheticBuildChannel } from "../-compatibility-join";

const formatMetadataJson = (metadataJson: string) => {
  const parsed = safeJsonParse(metadataJson);
  return parsed === null ? metadataJson : JSON.stringify(parsed, null, 2);
};

/** `{}` is what a build with nothing extra records — a code block around it is furniture. */
const hasMetadata = (metadataJson: string): boolean => {
  const parsed = safeJsonParse(metadataJson);
  return typeof parsed === "object" && parsed !== null
    ? Object.keys(parsed).length > 0
    : metadataJson.trim().length > 0;
};

// A build's own identity, laid across the panel.
//
// This used to be six fields two-across, with the ID, the fingerprint and the
// metadata each taking a full row to themselves — 64 hex characters wrapped over
// two lines beside half a screen of nothing. Long values are shown by their head
// and copied whole, which is what lets the whole set stand in one band.
const BuildMetadataCard = ({
  build,
  projectSlug,
}: {
  build: BuildWithArtifact;
  projectSlug: string;
}) => (
  <ListPanel>
    <ListPanelHeader title="Build metadata" />
    <DetailStatStrip columns={3}>
      <DetailStat label="Build ID">
        <CopyableId value={build.id} label="Build ID" length={20} />
      </DetailStat>
      <DetailStat label="Runtime version">
        {build.runtimeVersion ? (
          `v${build.runtimeVersion}`
        ) : (
          <Badge variant="warning">Missing</Badge>
        )}
      </DetailStat>
      <DetailStat label="Bundle ID">
        {build.bundleId === null ? (
          <Badge variant="warning">Missing</Badge>
        ) : (
          <>
            <span className="truncate font-mono text-xs" title={build.bundleId}>
              {build.bundleId}
            </span>
            <CopyButton value={build.bundleId} label="Bundle ID" />
          </>
        )}
      </DetailStat>
      <DetailStat label="Git ref">
        {build.gitRef ?? <span className="text-kumo-subtle italic">Not provided</span>}
      </DetailStat>
      <DetailStat label="Git commit">
        {build.gitCommit === null ? (
          <span className="text-kumo-subtle italic">Not provided</span>
        ) : (
          <>
            <code className="font-mono text-xs">{build.gitCommit.slice(0, 12)}</code>
            {build.gitDirty ? <span className="text-kumo-warning text-xs">·dirty</span> : null}
            <CopyButton value={build.gitCommit} label="Git commit" />
          </>
        )}
      </DetailStat>
      <DetailStat label="Fingerprint">
        {build.fingerprintHash === null ? (
          <span className="text-kumo-subtle italic">Not recorded</span>
        ) : (
          <>
            <RouterLink
              to="/projects/$projectSlug/fingerprints/$hash"
              params={{ projectSlug, hash: build.fingerprintHash }}
              className="font-mono text-xs"
            >
              {build.fingerprintHash.slice(0, 16)}
            </RouterLink>
            <CopyButton value={build.fingerprintHash} label="Fingerprint" />
          </>
        )}
      </DetailStat>
    </DetailStatStrip>
    {/* Only when there is something in it: a labelled "None recorded" is a
        field announcing its own absence, and most builds record nothing extra. */}
    {hasMetadata(build.metadataJson) ? (
      <div className="border-kumo-line flex flex-col gap-1 border-t p-4">
        <span className="text-kumo-subtle text-xs">Metadata JSON</span>
        <pre className="bg-kumo-tint overflow-x-auto rounded-md p-3 text-xs">
          {formatMetadataJson(build.metadataJson)}
        </pre>
      </div>
    ) : null}
  </ListPanel>
);

// The binary itself. Its two verbs used to be repeated here as body buttons
// under the same two in the page header — one page offering to download the
// artifact twice — so the panel now says only what the header cannot: the shape
// of the file and where it landed.
const ArtifactCard = ({ build }: { build: BuildWithArtifact }) => (
  <ListPanel>
    <ListPanelHeader title="Artifact" />
    {build.artifact ? (
      <DetailStatStrip columns={2}>
        <DetailStat label="File">
          {FORMAT_LABELS[build.artifact.format]} · {formatBytes(build.artifact.byteSize)}
        </DetailStat>
        <DetailStat label="Content type">
          <span className="truncate font-mono text-xs">{build.artifact.contentType}</span>
        </DetailStat>
        <DetailStat label="SHA-256">
          <code className="font-mono text-xs">{build.artifact.sha256.slice(0, 16)}</code>
          <CopyButton value={build.artifact.sha256} label="SHA-256" />
        </DetailStat>
        <DetailStat label="Storage key">
          <span className="truncate font-mono text-xs" title={build.artifact.r2Key}>
            {build.artifact.r2Key}
          </span>
          <CopyButton value={build.artifact.r2Key} label="Storage key" />
        </DetailStat>
      </DetailStatStrip>
    ) : (
      <ListPanelFooter>
        <span className="text-kumo-subtle text-sm">
          No artifact has been finalized for this build yet.
        </span>
      </ListPanelFooter>
    )}
  </ListPanel>
);

const DEBUG_ARTIFACT_LABELS: Record<BuildDebugArtifact["type"], string> = {
  dsym: "iOS debug symbols (dSYM)",
  "js-sourcemap": "JS bundle sourcemap",
  "proguard-mapping": "R8/ProGuard mapping",
  "native-symbols": "Android native symbols",
};

const DebugArtifactRow = ({
  buildId,
  artifact,
}: {
  buildId: string;
  artifact: BuildDebugArtifact;
}) => {
  const download = useApiMutation({
    mutationFn: async () => fetchDebugArtifactDownload(buildId, artifact.type),
    onSuccess: ({ url }) => {
      // Same-tab navigation: the presigned URL is signed with an attachment
      // content-disposition, so this saves the file without leaving the page.
      // (window.open here would run outside the click's user-gesture stack —
      // after the await — and get popup-blocked on Safari by default.)
      globalThis.location.assign(url);
    },
  });
  return (
    <div className="border-kumo-line flex items-center justify-between gap-3 border-b px-4 py-3 last:border-0">
      <div className="flex min-w-0 flex-wrap items-baseline gap-2">
        <span className="truncate text-sm font-medium">{DEBUG_ARTIFACT_LABELS[artifact.type]}</span>
        <span className="text-kumo-subtle text-xs tabular-nums">
          {formatBytes(artifact.byteSize)}
        </span>
      </div>
      <Button
        variant="secondary"
        size="sm"
        disabled={download.isPending}
        onClick={() => {
          download.mutate();
        }}
      >
        Download
      </Button>
    </div>
  );
};

// No description under the title: the only thing worth saying about debug
// symbols is said by the empty state, and on a build that has them the rows
// name themselves.
const DebugSymbolsCard = ({
  buildId,
  artifacts,
}: {
  buildId: string;
  artifacts: readonly BuildDebugArtifact[];
}) => (
  <ListPanel>
    <ListPanelHeader title="Debug symbols" />
    {artifacts.length > 0 ? (
      artifacts.map((artifact) => (
        <DebugArtifactRow
          key={`${buildId}:${artifact.type}`}
          buildId={buildId}
          artifact={artifact}
        />
      ))
    ) : (
      <ListPanelFooter>
        <span className="text-kumo-subtle text-sm">
          None stored for this build. Builds made with a current CLI capture dSYMs, JS sourcemaps
          and R8 mappings automatically.
        </span>
      </ListPanelFooter>
    )}
  </ListPanel>
);

/**
 * A channel this build can receive updates from — the whole row is the link.
 *
 * Every row used to end in an "Open →" that said the same thing as the row
 * beside it, which is a verb column standing in for a link the row could have
 * been. Now the row navigates, and the caret only shows itself under the
 * pointer, the way the tables elsewhere in the dashboard disclose theirs.
 */
const CompatibleChannelRow = ({
  projectSlug,
  channel,
}: {
  projectSlug: string;
  channel: SyntheticBuildChannel;
}) => (
  <Link
    to="/projects/$projectSlug/channels/$channelId"
    params={{ projectSlug, channelId: channel.channelId }}
    className={cn(ROW_LINK_DIVIDED, "group/row flex items-center justify-between gap-3 px-4 py-3")}
  >
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <ChannelBadge name={channel.channelName} />
      {channel.isPaused ? <Badge variant="warning">Paused</Badge> : null}
      {channel.rolloutActive ? <Badge variant="secondary">Rollout active</Badge> : null}
      <span className="text-kumo-subtle text-sm">
        {channel.updateCount > 0
          ? `${channel.updateCount} matching ${pluralize(channel.updateCount, "update")}`
          : "No matching updates"}
      </span>
    </span>
    <CaretRightIcon
      aria-hidden
      weight="bold"
      className="text-kumo-subtle size-4 shrink-0 opacity-0 transition-opacity duration-(--duration-quick) group-focus-within/row:opacity-100 group-hover/row:opacity-100"
    />
  </Link>
);

const RelatedChannelsCard = ({
  projectSlug,
  build,
}: {
  projectSlug: string;
  build: BuildWithSyntheticChannels;
}) => {
  const pagination = useClientPagination(build.channels, "channel");
  return (
    <ListPanel>
      <ListPanelHeader title="Compatible channels" />
      {build.channels.length > 0 ? (
        <>
          {pagination.pageItems.map((channel) => (
            <CompatibleChannelRow
              key={`${build.id}:${channel.channelId}`}
              projectSlug={projectSlug}
              channel={channel}
            />
          ))}
          <ListPanelFooter>
            <ClientPaginationBar state={pagination} />
          </ListPanelFooter>
        </>
      ) : (
        <ListPanelFooter>
          <span className="text-kumo-subtle text-sm">
            No channels currently match this build&apos;s runtime version.
          </span>
        </ListPanelFooter>
      )}
    </ListPanel>
  );
};

const BuildNotFoundState = ({ projectSlug }: { projectSlug: string }) => (
  <DetailNotFound
    icon={<PackageIcon />}
    title="Build not found in this project"
    description="The requested build exists outside this project or was removed."
    backLink={
      <RouterLinkButton to="/projects/$projectSlug" params={{ projectSlug }}>
        Back to project
      </RouterLinkButton>
    }
  />
);

// What names this build: where it runs, how it is handed out, which version it
// is, and when it landed. Runtime and git ref belong to the metadata card below
// — a header that lists every field is the card, printed twice.
const BuildHeaderMeta = ({ build }: { build: BuildWithArtifact }) => (
  <>
    <PlatformIndicator platform={build.platform} />
    <DistributionIndicator distribution={build.distribution} />
    {build.appVersion ? (
      <span className="font-mono text-xs">
        App {build.appVersion}
        {build.buildNumber ? ` (#${build.buildNumber})` : ""}
      </span>
    ) : null}
    <span>
      Created <RelativeTime value={build.createdAt} />
    </span>
  </>
);

/**
 * Detail-page header: shared DetailHeader anatomy with the build's title,
 * meta chips, and install/download/delete actions.
 */
const BuildDetailHeader = ({
  build,
  orgId,
  projectId,
}: {
  build: BuildWithArtifact;
  orgId: string;
  projectId: string;
}) => (
  <DetailHeader
    title={(build.message ?? build.profile) || `Build ${build.id.slice(0, 8)}`}
    meta={<BuildHeaderMeta build={build} />}
    actions={
      <>
        {build.artifact ? (
          <>
            <InstallLinkDialog build={build} buttonVariant="outline" buttonLabel="Install" />
            <a
              aria-label="Download artifact"
              className={buttonVariants({ variant: "secondary" })}
              href={`/api/builds/${build.id}/artifact`}
            >
              Download
            </a>
          </>
        ) : null}
        <DeleteBuildDialog build={build} orgId={orgId} projectId={projectId} />
      </>
    }
  />
);

const BuildDetailContent = () => {
  const { buildId } = Route.useParams();
  const { activeOrg, project } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const projectId = project.id;
  // One useSuspenseQueries call so all three requests start in parallel —
  // sequential useSuspenseQuery hooks suspend one at a time and waterfall.
  const [{ data: build }, { data: compatibilityData }, { data: debugArtifacts }] =
    useSuspenseQueries({
      queries: [
        buildQueryOptions(orgId, buildId),
        buildCompatibilityMatrixQueryOptions(orgId, projectId),
        buildDebugArtifactsQueryOptions(orgId, buildId),
      ],
    });

  const buildWithChannels = synthesizeBuildChannels(build, compatibilityData);

  if (build.projectId !== projectId) {
    return <BuildNotFoundState projectSlug={project.slug} />;
  }

  return (
    <>
      <BuildDetailHeader build={build} orgId={orgId} projectId={projectId} />
      {/* What the build is comes first, across the page — it used to sit at the
          bottom under everything it identifies. Then the binary and its symbols
          in one column against the channels it can reach in the other: a build
          with no artifact says so in a line, and stacking keeps that line from
          being padded out to the height of the list beside it. */}
      <BuildMetadataCard build={build} projectSlug={project.slug} />
      <div className="grid items-start gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="flex flex-col gap-4">
          <ArtifactCard build={build} />
          <DebugSymbolsCard buildId={build.id} artifacts={debugArtifacts.items} />
        </div>
        <RelatedChannelsCard projectSlug={project.slug} build={buildWithChannels} />
      </div>
    </>
  );
};

const BuildDetailSkeleton = () => (
  <>
    <DetailHeader title="Build" />
    <DetailCardSkeleton rows={2} columns={3} hasDescription={false} />
    <div className="grid items-start gap-4 lg:grid-cols-[1.15fr_0.85fr]">
      <div className="flex flex-col gap-4">
        <DetailCardSkeleton rows={2} columns={2} hasDescription={false} />
        <DetailCardSkeleton rows={1} columns={1} hasDescription={false} />
      </div>
      <DetailCardSkeleton rows={3} columns={1} hasDescription={false} />
    </div>
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
