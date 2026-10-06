import type { DesktopRelease, SparkleDelta } from "@better-update/api";

import type { DesktopReleaseModel, SparkleDeltaModel } from "../desktop-release-models";

export const toApiDesktopRelease = (model: DesktopReleaseModel): DesktopRelease => ({
  id: model.id,
  projectId: model.projectId,
  buildId: model.buildId,
  platform: model.platform,
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
  winSparkleSigned: model.winSparkleEdSignature !== null,
  blockmap: model.blockmap,
  sparkleDeltas: model.sparkleDeltas,
  createdAt: model.createdAt,
  updatedAt: model.updatedAt,
});

export const toApiSparkleDelta = (model: SparkleDeltaModel): SparkleDelta => ({
  id: model.id,
  buildId: model.buildId,
  deltaFrom: model.deltaFrom,
  byteSize: model.byteSize,
  sha256: model.sha256,
  sparkleExecutableSize: model.sparkleExecutableSize,
  sparkleLocales: model.sparkleLocales,
  createdAt: model.createdAt,
});
