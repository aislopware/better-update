/**
 * App Store **version** operations on the headless ASC (`@expo/apple-utils`)
 * entity layer — the editable "App Store" version of an app (version string,
 * attached build, release type, per-locale metadata). Backs the
 * `app-store version` command group. Each function takes a resolved
 * {@link AscSession} context + app id and returns plain data for the JSON
 * envelope.
 */
import { compact } from "@better-update/type-guards";
import AppleUtils from "@expo/apple-utils";
import { Effect } from "effect";

import { wrapConnect } from "../lib/apple-asc-connect";
import { AppStoreError } from "../lib/exit-codes";

/** An App Store version projected to the fields the CLI surfaces. */
export interface VersionView {
  readonly id: string;
  readonly versionString: string;
  readonly platform: string;
  readonly state: string;
}

/** Prefer the modern `appVersionState`, falling back to the legacy `appStoreState`. */
const stateOf = (version: AppleUtils.AppStoreVersion): string =>
  version.attributes.appVersionState ??
  // eslint-disable-next-line typescript/no-deprecated -- legacy display fallback: appVersionState is null on pre-3.3 versions, where appStoreState is the only state available
  version.attributes.appStoreState;

const toView = (version: AppleUtils.AppStoreVersion): VersionView => ({
  id: version.id,
  versionString: version.attributes.versionString,
  platform: version.attributes.platform,
  state: stateOf(version),
});

/** Fetch the `App` entity so its instance helpers (versions, edit version) are reachable. */
export const getApp = (ctx: AppleUtils.RequestContext, appId: string) =>
  wrapConnect("apple-get-app", async () => AppleUtils.App.infoAsync(ctx, { id: appId }));

/** List every App Store version of an app (newest first, Apple's default order). */
export const listVersions = (ctx: AppleUtils.RequestContext, appId: string) =>
  Effect.gen(function* () {
    const app = yield* getApp(ctx, appId);
    const versions = yield* wrapConnect("apple-list-versions", async () =>
      app.getAppStoreVersionsAsync(),
    );
    return versions.map(toView);
  });

/**
 * Ensure an App Store version exists for `versionString`, creating it (or
 * renaming the current editable version) as needed. Idempotent: a re-run with
 * the same version is a no-op that returns the existing version.
 */
export const ensureVersion = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  versionString: string,
  platform: AppleUtils.Platform,
) =>
  Effect.gen(function* () {
    const app = yield* getApp(ctx, appId);
    const version = yield* wrapConnect("apple-ensure-version", async () =>
      app.ensureVersionAsync(versionString, platform),
    );
    if (version === null) {
      return yield* new AppStoreError({
        message: `Could not create or resolve App Store version ${versionString}.`,
      });
    }
    return toView(version);
  });

/**
 * Resolve the current **editable** App Store version (the one in "Prepare for
 * Submission" / a rejected state). Returns the raw entity so callers can mutate
 * it. Fails clearly when there is none to edit.
 */
export const getEditableVersion = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  platform: AppleUtils.Platform,
) =>
  Effect.gen(function* () {
    const app = yield* getApp(ctx, appId);
    const version = yield* wrapConnect("apple-get-edit-version", async () =>
      app.getEditAppStoreVersionAsync({ platform }),
    );
    if (version === null) {
      return yield* new AppStoreError({
        message:
          "No editable App Store version found (none in 'Prepare for Submission'). Create one with `better-update app-store version create --version <x.y.z>`.",
      });
    }
    return version;
  });

/** How a command targets an uploaded build: an explicit id, a CFBundleVersion
 * ("build number"), or the newest upload. Precedence: id > version > latest. */
export interface BuildSelector {
  readonly buildId: string | undefined;
  readonly buildVersion: string | undefined;
  readonly latest?: boolean | undefined;
}

const NO_BUILD_SELECTOR = "Pass --build <id>, --build-version <n>, or --latest.";

/** Fetch the most recently uploaded build for an app, or fail if it has none. */
const findLatestBuild = (ctx: AppleUtils.RequestContext, appId: string) =>
  Effect.gen(function* () {
    const builds = yield* wrapConnect("apple-find-build", async () =>
      AppleUtils.Build.getAsync(ctx, {
        query: { filter: { app: appId }, sort: "-uploadedDate", limit: 1 },
      }),
    );
    const [build] = builds;
    if (build === undefined) {
      return yield* new AppStoreError({ message: "This app has no uploaded builds yet." });
    }
    return build;
  });

/** Fetch a build by its CFBundleVersion, or fail if none matches. */
const findBuildByVersion = (ctx: AppleUtils.RequestContext, appId: string, buildVersion: string) =>
  Effect.gen(function* () {
    const builds = yield* wrapConnect("apple-find-build", async () =>
      AppleUtils.Build.getAsync(ctx, {
        query: { filter: { app: appId, version: buildVersion }, limit: 1 },
      }),
    );
    const [build] = builds;
    if (build === undefined) {
      return yield* new AppStoreError({
        message: `No uploaded build with version ${buildVersion} found for this app.`,
      });
    }
    return build;
  });

/** Resolve an ASC build id from an explicit id, a CFBundleVersion, or the newest upload. */
export const resolveBuildId = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  selector: BuildSelector,
) =>
  Effect.gen(function* () {
    if (selector.buildId !== undefined) {
      return selector.buildId;
    }
    if (selector.buildVersion !== undefined) {
      return (yield* findBuildByVersion(ctx, appId, selector.buildVersion)).id;
    }
    if (selector.latest === true) {
      return (yield* findLatestBuild(ctx, appId)).id;
    }
    return yield* new AppStoreError({ message: NO_BUILD_SELECTOR });
  });

/**
 * Resolve a Build *entity* (not just its id) from an explicit ASC build id, a
 * CFBundleVersion ("build number"), or the newest upload (`latest`). The TestFlight
 * build/review commands need the entity to drive its instance methods; `app-store
 * version set` needs only the id via {@link resolveBuildId}.
 */
export const resolveBuild = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  selector: BuildSelector,
) =>
  Effect.gen(function* () {
    if (selector.buildId !== undefined) {
      const { buildId } = selector;
      return yield* wrapConnect("apple-get-build", async () =>
        AppleUtils.Build.infoAsync(ctx, { id: buildId }),
      );
    }
    if (selector.buildVersion !== undefined) {
      return yield* findBuildByVersion(ctx, appId, selector.buildVersion);
    }
    if (selector.latest === true) {
      return yield* findLatestBuild(ctx, appId);
    }
    return yield* new AppStoreError({ message: NO_BUILD_SELECTOR });
  });

export interface SetVersionInput {
  readonly buildId?: string;
  readonly versionString?: string;
  readonly releaseType?: AppleUtils.ReleaseType;
  readonly earliestReleaseDate?: string;
}

/**
 * Mutate the editable version: attach a build and/or change the version string,
 * release type, and scheduled release date. Returns the version's resulting view.
 */
export const setVersion = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  platform: AppleUtils.Platform,
  input: SetVersionInput,
) =>
  Effect.gen(function* () {
    let current = yield* getEditableVersion(ctx, appId, platform);
    if (input.buildId !== undefined) {
      const { buildId } = input;
      current = yield* wrapConnect("apple-attach-build", async () =>
        current.updateBuildAsync({ buildId }),
      );
    }
    const attributes = compact({
      versionString: input.versionString,
      releaseType: input.releaseType,
      earliestReleaseDate: input.earliestReleaseDate,
    });
    if (Object.keys(attributes).length > 0) {
      current = yield* wrapConnect("apple-update-version", async () =>
        current.updateAsync(attributes),
      );
    }
    return toView(current);
  });

export interface LocalizeVersionInput {
  readonly locale: string;
  readonly whatsNew?: string;
  readonly description?: string;
  readonly keywords?: string;
  readonly promotionalText?: string;
  readonly marketingUrl?: string;
  readonly supportUrl?: string;
}

/**
 * Set per-locale metadata on the editable version, creating the localization if
 * the app has none for that locale yet. Only the provided fields are written.
 */
export const localizeVersion = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  platform: AppleUtils.Platform,
  input: LocalizeVersionInput,
) =>
  Effect.gen(function* () {
    const version = yield* getEditableVersion(ctx, appId, platform);
    const localizations = yield* wrapConnect("apple-list-localizations", async () =>
      version.getLocalizationsAsync(),
    );
    const existing = localizations.find((loc) => loc.attributes.locale === input.locale);
    const attributes = compact({
      whatsNew: input.whatsNew,
      description: input.description,
      keywords: input.keywords,
      promotionalText: input.promotionalText,
      marketingUrl: input.marketingUrl,
      supportUrl: input.supportUrl,
    });
    if (Object.keys(attributes).length === 0) {
      return yield* new AppStoreError({
        message:
          "Nothing to set. Pass at least one of --whats-new, --description, --keywords, --promotional-text, --marketing-url, --support-url.",
      });
    }
    const target =
      existing ??
      (yield* wrapConnect("apple-create-localization", async () =>
        version.createLocalizationAsync({ locale: input.locale }),
      ));
    yield* wrapConnect("apple-update-localization", async () => target.updateAsync(attributes));
    return { locale: input.locale, versionId: version.id, fields: Object.keys(attributes) };
  });
