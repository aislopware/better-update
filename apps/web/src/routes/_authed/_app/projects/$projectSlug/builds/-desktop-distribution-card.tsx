import { readDesktopBuildMetadata } from "@better-update/api";

import type { BuildWithArtifact } from "@better-update/api";

import { DetailStat, DetailStatStrip } from "../../../../../../components/detail-stats";
import { ListPanel, ListPanelFooter, ListPanelHeader } from "../../../../../../lib/data-table";

const NotRecorded = () => <span className="text-kumo-subtle">Not recorded</span>;

/** The updaters whose signing key the app was built with, so a release must be signed for them. */
const updaterKeys = (metadata: {
  readonly tauriPublicKey?: string | undefined;
  readonly winSparklePublicKey?: string | undefined;
}): string =>
  [
    metadata.tauriPublicKey === undefined ? undefined : "Tauri",
    metadata.winSparklePublicKey === undefined ? undefined : "WinSparkle",
  ]
    .filter((name) => name !== undefined)
    .join(" · ");

/**
 * The Windows / Linux counterpart of the Developer ID card: the machines the
 * installer or package runs on and what its updates must be signed for.
 */
export const DesktopDistributionCard = ({
  build,
  platform,
}: {
  build: BuildWithArtifact;
  platform: "windows" | "linux";
}) => {
  const metadata = readDesktopBuildMetadata(platform, build.metadataJson);
  const keys = metadata === undefined ? "" : updaterKeys(metadata);
  return (
    <ListPanel>
      <ListPanelHeader
        title={platform === "windows" ? "Windows distribution" : "Linux distribution"}
      />
      {metadata ? (
        <DetailStatStrip columns={2}>
          <DetailStat label="Architectures">
            {metadata.architectures && metadata.architectures.length > 0 ? (
              <span className="font-mono text-xs">{metadata.architectures.join(" · ")}</span>
            ) : (
              <NotRecorded />
            )}
          </DetailStat>
          {platform === "windows" ? (
            <DetailStat label="Minimum Windows">
              {metadata.minimumSystemVersion ?? (
                <span className="text-kumo-subtle">Not declared</span>
              )}
            </DetailStat>
          ) : (
            <DetailStat label="Package name">
              {metadata.packageName === undefined ? (
                <NotRecorded />
              ) : (
                <span className="font-mono text-xs">{metadata.packageName}</span>
              )}
            </DetailStat>
          )}
          <DetailStat label="Updater keys">
            {keys === "" ? <span className="text-kumo-subtle">None embedded</span> : keys}
          </DetailStat>
          {build.artifact?.format === "appimage" ? (
            <DetailStat label="Differential updates">
              {metadata.blockMapSize === undefined ? (
                <span className="text-kumo-subtle">No embedded blockmap</span>
              ) : (
                "Embedded blockmap"
              )}
            </DetailStat>
          ) : null}
        </DetailStatStrip>
      ) : (
        <ListPanelFooter>
          <span className="text-kumo-subtle text-sm">
            Uploaded without package details. Builds uploaded with{" "}
            <code className="font-mono text-xs">
              better-update builds upload --platform {platform}
            </code>{" "}
            record their architectures here.
          </span>
        </ListPanelFooter>
      )}
    </ListPanel>
  );
};
