import type { DesktopRelease } from "@better-update/api";

import type { DesktopReleaseModel } from "../desktop-release-models";

export const toApiDesktopRelease = (model: DesktopReleaseModel): DesktopRelease => ({
  id: model.id,
  projectId: model.projectId,
  buildId: model.buildId,
  channel: model.channel,
  appVersion: model.appVersion,
  buildNumber: model.buildNumber,
  artifactFormat: model.artifactFormat,
  releaseNotes: model.releaseNotes,
  critical: model.critical,
  rolloutPercentage: model.rolloutPercentage,
  phasedRolloutHours: model.phasedRolloutHours,
  halted: model.halted,
  sparkleSigned: model.sparkleEdSignature !== null,
  tauriSigned: model.tauriSignature !== null,
  blockmap: model.blockmap,
  createdAt: model.createdAt,
  updatedAt: model.updatedAt,
});
