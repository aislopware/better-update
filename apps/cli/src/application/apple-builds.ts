/**
 * App Store Connect **pre-release build** operations on the headless ASC
 * (`@expo/apple-utils`) entity layer. Backs the `apple builds` command group:
 * list/inspect uploaded builds and answer the export-compliance question
 * (`usesNonExemptEncryption`) that otherwise strands a build in
 * `MISSING_EXPORT_COMPLIANCE`. All Token/CI-safe — no Apple login.
 *
 * The build *entity* is resolved by the shared `resolveBuild` (id or
 * CFBundleVersion); these helpers operate on it, so they take no `ctx` except the
 * static list.
 */
import { toDbNull } from "@better-update/type-guards";
import AppleUtils from "@expo/apple-utils";
import { Effect } from "effect";

import { wrapConnect } from "../lib/apple-asc-connect";

/** An uploaded build projected to the fields the CLI surfaces. */
export interface BuildView {
  readonly id: string;
  /** CFBundleVersion (the "build number"). */
  readonly version: string;
  /** CFBundleShortVersionString (the marketing version), from the pre-release version. */
  readonly appVersion: string | null;
  readonly platform: string | null;
  readonly processingState: string;
  readonly usesNonExemptEncryption: boolean;
  readonly expired: boolean;
  readonly uploadedDate: string;
}

const toView = (build: AppleUtils.Build): BuildView => ({
  id: build.id,
  version: build.attributes.version,
  appVersion: toDbNull(build.attributes.preReleaseVersion?.attributes.version),
  platform: toDbNull(build.attributes.preReleaseVersion?.attributes.platform),
  processingState: build.attributes.processingState,
  usesNonExemptEncryption: build.attributes.usesNonExemptEncryption,
  expired: build.attributes.expired,
  uploadedDate: build.attributes.uploadedDate,
});

/** List the app's uploaded builds, newest first. */
export const listBuilds = (ctx: AppleUtils.RequestContext, appId: string, limit: number) =>
  wrapConnect("apple-list-builds", async () =>
    AppleUtils.Build.getAsync(ctx, {
      query: { filter: { app: appId }, sort: "-uploadedDate", limit },
    }),
  ).pipe(Effect.map((builds) => builds.map(toView)));

/** Project a single resolved build to its {@link BuildView}. */
export const summarizeBuild = (build: AppleUtils.Build): BuildView => toView(build);

/** A build's processing + TestFlight beta status (internal/external state). */
export interface BuildStatus {
  readonly id: string;
  readonly version: string;
  readonly processingState: string;
  readonly usesNonExemptEncryption: boolean;
  readonly missingExportCompliance: boolean;
  readonly internalState: string | null;
  readonly externalState: string | null;
  readonly autoNotifyEnabled: boolean | null;
}

/**
 * Read a build's processing state and TestFlight beta detail. The beta-detail
 * getter is plural (returns an array); a build has at most one, so we take the
 * first.
 */
export const buildStatus = (build: AppleUtils.Build) =>
  Effect.gen(function* () {
    const details = yield* wrapConnect("apple-get-build-beta-detail", async () =>
      build.getBuildBetaDetailsAsync(),
    );
    const [detail] = details;
    return {
      id: build.id,
      version: build.attributes.version,
      processingState: build.attributes.processingState,
      usesNonExemptEncryption: build.attributes.usesNonExemptEncryption,
      missingExportCompliance: build.isMissingExportCompliance(),
      internalState: toDbNull(detail?.attributes.internalBuildState),
      externalState: toDbNull(detail?.attributes.externalBuildState),
      autoNotifyEnabled: toDbNull(detail?.attributes.autoNotifyEnabled),
    } satisfies BuildStatus;
  });

/**
 * Answer the export-compliance question on an uploaded build. Setting
 * `usesNonExemptEncryption=false` (the common case for apps using only exempt
 * encryption) clears `MISSING_EXPORT_COMPLIANCE` and unblocks TestFlight/App Store
 * processing.
 */
export const setBuildCompliance = (build: AppleUtils.Build, usesNonExemptEncryption: boolean) =>
  wrapConnect("apple-set-export-compliance", async () =>
    build.updateAsync({ usesNonExemptEncryption }),
  ).pipe(
    Effect.map((updated) => ({
      id: updated.id,
      version: updated.attributes.version,
      usesNonExemptEncryption: updated.attributes.usesNonExemptEncryption,
    })),
  );
