/**
 * Desktop feed telemetry into the `DESKTOP_ANALYTICS` Analytics Engine
 * dataset. One row per feed check and per download, told apart by blob2:
 *
 *   index1  `<projectId>:<installId>` (`:` alone without one) — distinct installs
 *   blob1   projectId
 *   blob2   "check" | "download"
 *   blob3   platform (macos | windows | linux)
 *   blob4   check: updater (sparkle | winsparkle | electron | tauri); download: format
 *   blob5   check: channel; download: transfer (full | range | blockmap)
 *   blob6   check: requested arch
 *   blob7   release id: the newest offered, or the one downloaded
 *   blob8   that release's version
 *   blob9   check: the asking app's version, when its updater says it
 *   double1 download: bytes sent
 */
import { Effect, Layer } from "effect";

import { DesktopAnalytics } from "../domain/desktop-analytics";
import { cloudflareEnv } from "./context";

/** Analytics Engine caps an index at 96 bytes; an install id is the client's to choose. */
const MAX_INSTALL_ID = 48;

const write = (point: AnalyticsEngineDataPoint) =>
  Effect.gen(function* () {
    const env = yield* cloudflareEnv;
    // writeDataPoint throws synchronously on a limit violation; telemetry never breaks a feed.
    yield* Effect.try(() => {
      env.DESKTOP_ANALYTICS.writeDataPoint(point);
    }).pipe(Effect.ignore);
  });

export const DesktopAnalyticsLive = Layer.succeed(DesktopAnalytics, {
  recordCheck: (event) =>
    write({
      indexes: [
        event.installId === null
          ? `${event.projectId}:`
          : `${event.projectId}:${event.installId.slice(0, MAX_INSTALL_ID)}`,
      ],
      blobs: [
        event.projectId,
        "check",
        event.platform,
        event.updater,
        event.channel,
        // eslint-disable-next-line eslint-js/no-restricted-syntax -- Analytics Engine blob slots are strings; "" is "not named"
        event.arch ?? "",
        // eslint-disable-next-line eslint-js/no-restricted-syntax -- "" is "no update offered"
        event.served?.releaseId ?? "",
        // eslint-disable-next-line eslint-js/no-restricted-syntax -- "" is "no update offered" or a release without a version
        event.served?.version ?? "",
        // eslint-disable-next-line eslint-js/no-restricted-syntax -- "" is "the updater did not say"
        event.clientVersion ?? "",
      ],
      doubles: [0],
    }),
  recordDownload: (event) =>
    write({
      indexes: [`${event.projectId}:`],
      blobs: [
        event.projectId,
        "download",
        event.platform,
        event.format,
        event.transfer,
        "",
        event.releaseId,
        // eslint-disable-next-line eslint-js/no-restricted-syntax -- "" is a release without a version
        event.version ?? "",
        "",
      ],
      doubles: [event.bytes],
    }),
});
