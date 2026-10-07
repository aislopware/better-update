import { Context } from "effect";

import type { DesktopPlatform } from "@better-update/api";
import type { Effect } from "effect";

/** Which updater asked: told apart by the feed file it read. */
export type DesktopUpdater = "sparkle" | "winsparkle" | "electron" | "tauri" | "apt";

/**
 * How a download went over the wire: the whole file, byte ranges of it, its
 * blockmap, or a Sparkle delta in its place.
 */
export type DesktopTransfer = "full" | "range" | "blockmap" | "delta";

export interface DesktopCheckEvent {
  readonly projectId: string;
  readonly platform: DesktopPlatform;
  readonly updater: DesktopUpdater;
  readonly channel: string;
  /** The architecture the request named (Tauri `{{arch}}`, an electron-updater channel file). */
  readonly arch: string | undefined;
  /** The newest release the answer offered; undefined for "no update". */
  readonly served: { readonly releaseId: string; readonly version: string | null } | undefined;
  /** The asking app's version, when its updater says it. */
  readonly clientVersion: string | undefined;
  readonly installId: string | null;
}

export interface DesktopDownloadEvent {
  readonly projectId: string;
  readonly platform: DesktopPlatform;
  readonly releaseId: string;
  readonly version: string | null;
  readonly format: string;
  readonly transfer: DesktopTransfer;
  /** Bytes the answer carries (a 302 to the full file counts the file's size). */
  readonly bytes: number;
}

/**
 * Desktop feed telemetry. Best-effort by contract: recording never fails and
 * never delays a feed answer.
 */
export interface DesktopAnalyticsImpl {
  readonly recordCheck: (event: DesktopCheckEvent) => Effect.Effect<void>;
  readonly recordDownload: (event: DesktopDownloadEvent) => Effect.Effect<void>;
}

export class DesktopAnalytics extends Context.Service<DesktopAnalytics, DesktopAnalyticsImpl>()(
  "server/DesktopAnalytics",
) {}
