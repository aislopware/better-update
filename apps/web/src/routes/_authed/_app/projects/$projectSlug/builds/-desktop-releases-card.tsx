import { desktopFeedUrls } from "@better-update/api";
import {
  buildDesktopReleasesQueryOptions,
  desktopAnalyticsQueryOptions,
} from "@better-update/api-client/react";
import { useSuspenseQueries } from "@tanstack/react-query";

import type { DesktopPlatform, DesktopRelease } from "@better-update/api";

import { CliCommandBlock } from "../../../../../../components/cli-command-block";
import { StatusDot } from "../../../../../../components/status-dot";
import { CopyableText } from "../../../../../../lib/copy-button";
import {
  ListPanel,
  ListPanelFooter,
  ListPanelHeader,
  ListPanelRow,
} from "../../../../../../lib/data-table";
import { numberFormatter } from "../../../../../../lib/format-number";
import { RelativeTime } from "../../../../../../lib/relative-time";
import { SITE } from "../../../../../../lib/site-config";

// The feeds are served by the API worker. In production it shares the
// dashboard's origin (`/feeds/*` routes to it); in development it has its own.
// An unset or empty VITE_API_URL both mean "same origin".
const feedOrigin = import.meta.env.VITE_API_URL || SITE.url;

const ReleaseState = ({ release }: { release: DesktopRelease }) => {
  if (release.halted) {
    return <StatusDot tone="muted">Halted</StatusDot>;
  }
  return release.rolloutPercentage === 100 ? (
    <StatusDot tone="success">Live</StatusDot>
  ) : (
    <StatusDot tone="info" pulse>
      {`Rolling out · ${String(release.rolloutPercentage)}%`}
    </StatusDot>
  );
};

/**
 * Which updaters will accept the file: Sparkle and WinSparkle need their
 * EdDSA signature, Tauri its minisign one; electron-updater checks the SHA-512.
 */
const signatureLabel = (release: DesktopRelease): string => {
  const signers = [
    release.sparkleSigned ? "Sparkle" : undefined,
    release.winSparkleSigned ? "WinSparkle" : undefined,
    release.tauriSigned ? "Tauri" : undefined,
  ].filter((signer) => signer !== undefined);
  if (signers.length > 0) {
    return ` · signed for ${signers.join(" + ")}`;
  }
  return release.platform === "macos" ? " · unsigned for Sparkle" : "";
};

/** Whole-file downloads in the last 30 days; undefined when telemetry is down. */
const downloadsLabel = (downloads: number | undefined): string =>
  downloads === undefined
    ? ""
    : ` · ${numberFormatter.format(downloads)} download${downloads === 1 ? "" : "s"} in 30 days`;

const ReleaseRow = ({
  release,
  downloads,
}: {
  release: DesktopRelease;
  downloads: number | undefined;
}) => (
  <ListPanelRow
    title={
      <>
        <span className="font-mono">{release.channel}</span>
        <ReleaseState release={release} />
      </>
    }
    description={
      <>
        Released <RelativeTime value={release.createdAt} />
        {signatureLabel(release)}
        {release.blockmap ? " · differential updates" : ""}
        {release.sparkleDeltas > 0
          ? ` · ${String(release.sparkleDeltas)} Sparkle delta${release.sparkleDeltas === 1 ? "" : "s"}`
          : ""}
        {release.critical ? " · critical" : ""}
        {downloadsLabel(downloads)}
        {release.phasedRolloutHours === null
          ? ""
          : ` · Sparkle phasing every ${String(release.phasedRolloutHours)}h`}
      </>
    }
  />
);

const FeedUrl = ({ label, url }: { label: string; url: string }) => (
  <div className="flex min-w-0 items-center gap-2 text-sm">
    <span className="text-kumo-subtle shrink-0">{label}</span>
    <CopyableText value={url} label={`${label} URL`} className="min-w-0" />
  </div>
);

/**
 * The URLs an app polls, per channel the build is released to, limited to the
 * updaters those releases serve.
 */
const FeedUrls = ({ releases }: { releases: readonly DesktopRelease[] }) => {
  const [first] = releases;
  if (first === undefined) {
    return null;
  }
  const channels = [...new Set(releases.map((release) => release.channel))];
  return (
    <ListPanelFooter>
      <div className="flex w-full min-w-0 flex-col gap-1.5">
        {channels.flatMap((channel) =>
          desktopFeedUrls({
            baseUrl: feedOrigin,
            projectId: first.projectId,
            platform: first.platform,
            channel,
            releases: releases.filter((release) => release.channel === channel),
          }).map((feed) => (
            <FeedUrl
              key={`${channel}:${feed.label}`}
              label={channels.length === 1 ? feed.label : `${feed.label} · ${channel}`}
              url={feed.url}
            />
          )),
        )}
      </div>
    </ListPanelFooter>
  );
};

/**
 * Where a desktop build stands in the project's update feeds — a build ships
 * to installed apps only once released to a channel, which the CLI does
 * because it signs the file with the Sparkle / WinSparkle / Tauri keys that
 * never leave the developer.
 */
export const DesktopReleasesCard = ({
  orgId,
  projectId,
  buildId,
  platform,
}: {
  orgId: string;
  projectId: string;
  buildId: string;
  platform: DesktopPlatform;
}) => {
  const [{ data }, { data: analytics }] = useSuspenseQueries({
    queries: [
      buildDesktopReleasesQueryOptions(orgId, projectId, buildId),
      desktopAnalyticsQueryOptions(orgId, projectId, "30d"),
    ],
  });
  const downloadsOf = (releaseId: string) =>
    analytics.unavailable
      ? undefined
      : (analytics.releases.find((entry) => entry.releaseId === releaseId)?.downloads ?? 0);
  return (
    <ListPanel>
      <ListPanelHeader title="Update feeds" />
      {data.items.length > 0 ? (
        <>
          {data.items.map((release) => (
            <ReleaseRow key={release.id} release={release} downloads={downloadsOf(release.id)} />
          ))}
          <FeedUrls releases={data.items} />
        </>
      ) : (
        <ListPanelFooter>
          <div className="flex w-full flex-col gap-3">
            <span className="text-kumo-subtle text-sm">
              Not released. Installed apps see this build once it is published to an update channel:
            </span>
            <CliCommandBlock commands={[`better-update ${platform} release create ${buildId}`]} />
          </div>
        </ListPanelFooter>
      )}
    </ListPanel>
  );
};
