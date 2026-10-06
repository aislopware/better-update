import { buildDesktopReleasesQueryOptions } from "@better-update/api-client/react";
import { useSuspenseQuery } from "@tanstack/react-query";

import type { DesktopRelease } from "@better-update/api";

import { CliCommandBlock } from "../../../../../../components/cli-command-block";
import { StatusDot } from "../../../../../../components/status-dot";
import { CopyableText } from "../../../../../../lib/copy-button";
import {
  ListPanel,
  ListPanelFooter,
  ListPanelHeader,
  ListPanelRow,
} from "../../../../../../lib/data-table";
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

/** Which updaters will accept the archive: Sparkle needs its EdDSA signature, Tauri its minisign one. */
const signatureLabel = (release: DesktopRelease): string => {
  const signers = [
    release.sparkleSigned ? "Sparkle" : undefined,
    release.tauriSigned ? "Tauri" : undefined,
  ].filter((signer) => signer !== undefined);
  return signers.length === 0 ? " · unsigned for Sparkle" : ` · signed for ${signers.join(" + ")}`;
};

const ReleaseRow = ({ release }: { release: DesktopRelease }) => (
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
        {release.critical ? " · critical" : ""}
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
 * The URLs an app polls. The appcast is one per project (it tags channels per
 * item); electron-updater reads one file per channel, and only zips; the Tauri
 * updater one JSON per channel, of signed `.app.tar.gz` releases.
 */
const FeedUrls = ({ releases }: { releases: readonly DesktopRelease[] }) => {
  const [first] = releases;
  if (first === undefined) {
    return null;
  }
  const feedBase = `${feedOrigin}/feeds/${first.projectId}/macos`;
  const channelsWhere = (keep: (release: DesktopRelease) => boolean) => [
    ...new Set(releases.filter(keep).map((release) => release.channel)),
  ];
  const electronChannels = channelsWhere((release) => release.artifactFormat === "zip");
  const tauriChannels = channelsWhere(
    (release) => release.artifactFormat === "tar.gz" && release.tauriSigned,
  );
  return (
    <ListPanelFooter>
      <div className="flex w-full min-w-0 flex-col gap-1.5">
        <FeedUrl label="Sparkle appcast" url={`${feedBase}/appcast.xml`} />
        {electronChannels.map((channel) => (
          <FeedUrl
            key={channel}
            label={`electron-updater · ${channel}`}
            url={`${feedBase}/${channel}-mac.yml`}
          />
        ))}
        {tauriChannels.map((channel) => (
          <FeedUrl
            key={`tauri-${channel}`}
            label={`Tauri updater · ${channel}`}
            url={`${feedBase}/${channel}-tauri.json`}
          />
        ))}
      </div>
    </ListPanelFooter>
  );
};

/**
 * Where a macOS build stands in the project's update feeds — a build ships to
 * installed apps only once released to a channel, which the CLI does because
 * it signs the archive with the Sparkle / Tauri keys that never leave the
 * developer.
 */
export const MacosReleasesCard = ({
  orgId,
  projectId,
  buildId,
}: {
  orgId: string;
  projectId: string;
  buildId: string;
}) => {
  const { data } = useSuspenseQuery(buildDesktopReleasesQueryOptions(orgId, projectId, buildId));
  return (
    <ListPanel>
      <ListPanelHeader title="Update feeds" />
      {data.items.length > 0 ? (
        <>
          {data.items.map((release) => (
            <ReleaseRow key={release.id} release={release} />
          ))}
          <FeedUrls releases={data.items} />
        </>
      ) : (
        <ListPanelFooter>
          <div className="flex w-full flex-col gap-3">
            <span className="text-kumo-subtle text-sm">
              Not released. Installed apps see this build once it is published to a Sparkle /
              electron-updater channel:
            </span>
            <CliCommandBlock commands={[`better-update macos release create ${buildId}`]} />
          </div>
        </ListPanelFooter>
      )}
    </ListPanel>
  );
};
