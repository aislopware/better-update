import { readMacosBuildMetadata } from "@better-update/api";
import { Badge } from "@better-update/ui/components/badge";

import type { BuildWithArtifact, MacosNotarization } from "@better-update/api";

import { DetailStat, DetailStatStrip } from "../../../../../../components/detail-stats";
import { CopyableText } from "../../../../../../lib/copy-button";
import { ListPanel, ListPanelFooter, ListPanelHeader } from "../../../../../../lib/data-table";

const NotarizationState = ({ notarization }: { notarization: MacosNotarization | undefined }) => {
  if (notarization === undefined) {
    return <span className="text-kumo-subtle">Not recorded</span>;
  }
  // Accepted and stapled is what every shipped build should be, so it reads as
  // plain text; only the states a user has to act on get a colour.
  if (notarization.status === "accepted") {
    return notarization.stapled ? "Accepted · ticket stapled" : "Accepted";
  }
  if (notarization.status === "pending") {
    return <Badge variant="warning">Pending with Apple</Badge>;
  }
  return <Badge variant="warning">Not notarized</Badge>;
};

/**
 * Where a mobile build lists the channels it takes updates from, a macOS build
 * — which never takes Expo updates — says how it reaches a Mac: the Gatekeeper
 * state of the shipped container and the machines it runs on.
 */
export const MacosDistributionCard = ({ build }: { build: BuildWithArtifact }) => {
  const macos = readMacosBuildMetadata(build.metadataJson);
  return (
    <ListPanel>
      <ListPanelHeader title="Developer ID distribution" />
      {macos ? (
        <DetailStatStrip columns={2}>
          <DetailStat label="Notarization">
            <NotarizationState notarization={macos.notarization} />
          </DetailStat>
          <DetailStat label="Minimum macOS">
            {macos.minimumSystemVersion ?? <span className="text-kumo-subtle">Not declared</span>}
          </DetailStat>
          <DetailStat label="Architectures">
            {macos.architectures && macos.architectures.length > 0 ? (
              <span className="font-mono text-xs">{macos.architectures.join(" · ")}</span>
            ) : (
              <span className="text-kumo-subtle">Not recorded</span>
            )}
          </DetailStat>
          <DetailStat label="Team ID">
            {macos.teamId ? (
              <CopyableText value={macos.teamId} label="Team ID" />
            ) : (
              <span className="text-kumo-subtle">Not recorded</span>
            )}
          </DetailStat>
          {macos.notarization?.submissionId ? (
            <DetailStat label="Notary submission" className="sm:col-span-2">
              <CopyableText value={macos.notarization.submissionId} label="Submission ID" />
            </DetailStat>
          ) : null}
        </DetailStatStrip>
      ) : (
        <ListPanelFooter>
          <span className="text-kumo-subtle text-sm">
            Uploaded without signing details. Builds made with{" "}
            <code className="font-mono text-xs">better-update build --platform macos</code> record
            their notarization state here.
          </span>
        </ListPanelFooter>
      )}
    </ListPanel>
  );
};
