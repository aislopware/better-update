import { Effect } from "effect";

import { cloudflareEnv } from "./context";

import type { ProtocolHeaders } from "../protocol/headers";
import type { ResponseType } from "../protocol/response-type";

export type TrackManifestResponse = (
  branchId: string,
  updateId: string,
  responseType: ResponseType,
) => void;

export interface ManifestRuntime {
  readonly assetBaseUrl: string;
  readonly createTracker: (params: {
    readonly projectId: string;
    readonly ph: ProtocolHeaders;
    readonly startTime: number;
  }) => TrackManifestResponse;
}

export const manifestRuntime: Effect.Effect<ManifestRuntime> = Effect.gen(function* () {
  const env = yield* cloudflareEnv;
  return {
    assetBaseUrl: env.ASSET_CDN_URL,
    createTracker:
      ({ projectId, ph, startTime }) =>
      (branchId, updateId, responseType) => {
        env.ANALYTICS.writeDataPoint({
          indexes: [`${projectId}:${ph.easClientId ?? crypto.randomUUID()}`],
          blobs: [
            projectId,
            ph.channelName,
            branchId,
            updateId,
            ph.platform,
            ph.runtimeVersion,
            responseType,
            ph.extraParams ?? "",
          ],
          doubles: [Date.now() - startTime, 0],
        });
      },
  };
});
