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
  /** CDN origin for non-launch assets (served directly, never patched). */
  readonly assetBaseUrl: string;
  /**
   * Worker origin used to build the launch-bundle URL so the device hits the
   * Worker (not the CDN) and the Worker can perform bsdiff A-IM negotiation.
   */
  readonly serverBaseUrl: string;
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
    serverBaseUrl: env.PUBLIC_API_URL,
    createTracker:
      ({ projectId, ph, startTime }) =>
      (branchId, updateId, responseType) => {
        // Anti-brick crash telemetry rides the existing non-blocking Analytics
        // Engine hot path — no new D1 column, no added latency (writeDataPoint
        // is ctx-deferred by AE design). doubles[1] is the crash flag (1 when
        // the device reported a prior fatal error, else 0). The fatal-error
        // string (already 1024-clamped at parse) + the recent-failed-id count
        // ride spare blob slots after extraParams so anti-brick observability is
        // queryable. This write can never affect the served response — it is
        // inside the fire-and-forget tracker.
        //
        // Telemetry is STRICTLY best-effort: writeDataPoint can throw
        // synchronously (e.g. on an AE limit violation — the index is capped at
        // 96 bytes; easClientId is bounded at parse so the worst-case composite
        // `${36-char UUID}:${58-char id}` = 95 bytes stays within budget, but
        // defense-in-depth is cheap here). A throw must NEVER escape this tracker,
        // or it would surface as an Effect defect and 500 the manifest path.
        // Swallow any throw to void — serving must never fail because telemetry did.
        // eslint-disable-next-line functional/no-try-statements -- Analytics Engine writeDataPoint may throw synchronously on a limit violation; telemetry is best-effort and must never fail serving (priority #4: telemetry must never fail the manifest path)
        try {
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
              // eslint-disable-next-line eslint-js/no-restricted-syntax -- Analytics Engine blob slot requires string; missing extraParams logged as empty
              ph.extraParams ?? "",
              // eslint-disable-next-line eslint-js/no-restricted-syntax -- Analytics Engine blob slot requires string; missing fatalError logged as empty
              ph.fatalError ?? "",
              String(ph.recentFailedUpdateIds.length),
            ],
            doubles: [Date.now() - startTime, ph.fatalError ? 1 : 0],
          });
        } catch {
          // Best-effort telemetry: drop the write, never break serving.
        }
      },
  };
});
