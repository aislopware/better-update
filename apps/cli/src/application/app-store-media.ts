import path from "node:path";

/**
 * App Store **store media** (screenshots + preview videos) on the headless ASC
 * (`@expo/apple-utils`) AssetAPI: list, upload, clear, and declaratively sync a
 * `screenshots/<locale>/<device>/*.png` tree. Backs the top-level `metadata`
 * command group. All Token/CI-safe — apple-utils exposes native binary upload
 * (reserve → PUT → commit → poll) for media, unlike the `.ipa` (altool).
 *
 * Media lives on the **editable** App Store version's per-locale localizations,
 * so every op resolves {@link getEditableVersion} first. Screenshot/preview sets
 * are fetched via the localization (which always includes their child assets), so
 * `set.attributes.appScreenshots` / `appPreviews` are populated for counts + clear.
 */
import { compact, toDbNull } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
import AppleUtils from "@expo/apple-utils";
import { Effect } from "effect";

import { wrapConnect } from "../lib/apple-asc-connect";
import { resolveScreenshotDisplayType } from "../lib/asc-display-types";
import { InvalidArgumentError } from "../lib/exit-codes";
import { getEditableVersion } from "./app-store-versions";

/** Image extensions App Store screenshots accept. */
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);

const screenshotState = (shot: AppleUtils.AppScreenshot): string => {
  if (shot.isFailed()) {
    return "FAILED";
  }
  return shot.isComplete() ? "COMPLETE" : "PROCESSING";
};

const previewState = (preview: AppleUtils.AppPreview): string => {
  if (preview.isFailed()) {
    return "FAILED";
  }
  return preview.isComplete() ? "COMPLETE" : "PROCESSING";
};

/** Find the editable version's localization for `locale`, or `null` when absent. */
const findLocalization = (version: AppleUtils.AppStoreVersion, locale: string) =>
  wrapConnect("apple-list-localizations", async () => version.getLocalizationsAsync()).pipe(
    Effect.map((localizations) =>
      toDbNull(localizations.find((loc) => loc.attributes.locale === locale)),
    ),
  );

/** Resolve the editable version's localization for `locale`, creating it when absent. */
const getOrCreateLocalization = (version: AppleUtils.AppStoreVersion, locale: string) =>
  Effect.gen(function* () {
    const existing = yield* findLocalization(version, locale);
    if (existing !== null) {
      return existing;
    }
    return yield* wrapConnect("apple-create-localization", async () =>
      version.createLocalizationAsync({ locale }),
    );
  });

/** List the localization's screenshot sets (child screenshots are included by apple-utils). */
const listScreenshotSets = (localization: AppleUtils.AppStoreVersionLocalization) =>
  wrapConnect("apple-list-screenshot-sets", async () => localization.getAppScreenshotSetsAsync());

/** Create a fresh (empty) screenshot set for a display type on a localization. */
const createScreenshotSet = (
  localization: AppleUtils.AppStoreVersionLocalization,
  displayType: AppleUtils.ScreenshotDisplayType,
) =>
  wrapConnect("apple-create-screenshot-set", async () =>
    localization.createAppScreenshotSetAsync({ screenshotDisplayType: displayType }),
  );

/** Resolve the preview set for a preview type on a localization, creating it when absent. */
const getOrCreatePreviewSet = (
  localization: AppleUtils.AppStoreVersionLocalization,
  previewType: AppleUtils.PreviewType,
) =>
  Effect.gen(function* () {
    const sets = yield* wrapConnect("apple-list-preview-sets", async () =>
      localization.getAppPreviewSetsAsync(),
    );
    const existing = sets.find((set) => set.attributes.previewType === previewType);
    if (existing !== undefined) {
      return existing;
    }
    return yield* wrapConnect("apple-create-preview-set", async () =>
      localization.createAppPreviewSetAsync({ previewType }),
    );
  });

/**
 * Delete every screenshot in a set (the set itself persists — apple-utils has no
 * set delete). The `set` MUST come from {@link listScreenshotSets}, which includes
 * the child `appScreenshots`; freshly-created sets omit the relationship.
 */
const deleteScreenshotsOf = (ctx: AppleUtils.RequestContext, set: AppleUtils.AppScreenshotSet) =>
  Effect.gen(function* () {
    const shots = set.attributes.appScreenshots;
    yield* Effect.forEach(
      shots,
      (shot) =>
        wrapConnect("apple-delete-screenshot", async () =>
          AppleUtils.AppScreenshot.deleteAsync(ctx, { id: shot.id }),
        ),
      { concurrency: "inherit" },
    );
    return shots.length;
  });

/** Upload one screenshot file into a set, waiting for Apple to finish processing it. */
const uploadOneScreenshot = (set: AppleUtils.AppScreenshotSet, filePath: string) =>
  wrapConnect("apple-upload-screenshot", async () =>
    // `position` is intentionally omitted: apple-utils' position path re-fetches the
    // set without including appScreenshots and then maps over it (throws). Order
    // follows upload order instead.
    set.uploadScreenshot({ filePath, waitForProcessing: true }),
  );

/** Collect the image files in a directory, sorted by name (the upload order). */
const collectImages = (dir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const entries = yield* fs.readDirectory(dir).pipe(
      Effect.mapError(
        (cause) =>
          new InvalidArgumentError({
            message: `Could not read directory "${dir}": ${String(cause)}`,
          }),
      ),
    );
    // Numeric-aware sort so `2.png` precedes `10.png` (upload order == on-store
    // order, since uploadScreenshot omits `position`). Plain lexicographic order
    // would publish 1, 10, 11, 2, … out of sequence.
    const imageNames = [...entries]
      .filter((name) => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()))
      .toSorted((left, right) => left.localeCompare(right, "en", { numeric: true }));
    const images: string[] = [];
    for (const name of imageNames) {
      const full = path.join(dir, name);
      const info = yield* fs.stat(full).pipe(Effect.orElseSucceed(() => null));
      // Keep image-extension entries whose stat fails (broken symlink / perms /
      // race) so the upload surfaces a real error instead of silently dropping
      // them; only skip entries confirmed to be a non-file (e.g. a dir "x.png").
      if (info === null || info.type === "File") {
        images.push(full);
      }
    }
    return images;
  });

// ── media list ───────────────────────────────────────────────────

/** One media set projected to the fields the CLI surfaces. */
export interface MediaSetView {
  readonly locale: string;
  readonly kind: "screenshot" | "preview";
  readonly device: string;
  readonly count: number;
  readonly setId: string;
}

/** List the editable version's screenshot + preview sets, optionally for one locale. */
export const listMedia = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  platform: AppleUtils.Platform,
  locale: string | undefined,
) =>
  Effect.gen(function* () {
    const version = yield* getEditableVersion(ctx, appId, platform);
    const localizations = yield* wrapConnect("apple-list-localizations", async () =>
      version.getLocalizationsAsync(),
    );
    const targets =
      locale === undefined
        ? localizations
        : localizations.filter((loc) => loc.attributes.locale === locale);
    const rows: MediaSetView[] = [];
    for (const loc of targets) {
      const [screenshotSets, previewSets] = yield* wrapConnect("apple-list-media-sets", async () =>
        Promise.all([loc.getAppScreenshotSetsAsync(), loc.getAppPreviewSetsAsync()]),
      );
      for (const set of screenshotSets) {
        rows.push({
          locale: loc.attributes.locale,
          kind: "screenshot",
          device: set.attributes.screenshotDisplayType,
          count: set.attributes.appScreenshots.length,
          setId: set.id,
        });
      }
      for (const set of previewSets) {
        rows.push({
          locale: loc.attributes.locale,
          kind: "preview",
          device: set.attributes.previewType,
          count: set.attributes.appPreviews.length,
          setId: set.id,
        });
      }
    }
    return rows;
  });

// ── screenshots upload / clear ───────────────────────────────────

export interface UploadScreenshotsInput {
  readonly locale: string;
  readonly displayType: AppleUtils.ScreenshotDisplayType;
  /** A directory of images (uploaded in sorted name order), and/or explicit files. */
  readonly dir?: string;
  readonly files?: readonly string[];
  /** Clear the set's existing screenshots before uploading. */
  readonly replace: boolean;
}

export interface UploadedScreenshot {
  readonly id: string;
  readonly fileName: string;
  readonly state: string;
}

/** Upload screenshots into a locale + device set on the editable version. */
export const uploadScreenshots = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  platform: AppleUtils.Platform,
  input: UploadScreenshotsInput,
) =>
  Effect.gen(function* () {
    const fromDir = input.dir === undefined ? [] : yield* collectImages(input.dir);
    const filePaths = [...(input.files ?? []), ...fromDir];
    if (filePaths.length === 0) {
      return yield* new InvalidArgumentError({
        message: "No images to upload. Pass --dir <folder of .png/.jpg> or --file <image>.",
      });
    }
    const version = yield* getEditableVersion(ctx, appId, platform);
    const localization = yield* getOrCreateLocalization(version, input.locale);
    const sets = yield* listScreenshotSets(localization);
    const existing = sets.find((set) => set.attributes.screenshotDisplayType === input.displayType);
    let cleared = 0;
    if (input.replace && existing !== undefined) {
      cleared = yield* deleteScreenshotsOf(ctx, existing);
    }
    const set = existing ?? (yield* createScreenshotSet(localization, input.displayType));
    const uploaded: UploadedScreenshot[] = [];
    for (const filePath of filePaths) {
      const shot = yield* uploadOneScreenshot(set, filePath);
      uploaded.push({
        id: shot.id,
        fileName: shot.attributes.fileName,
        state: screenshotState(shot),
      });
    }
    return {
      locale: input.locale,
      device: input.displayType,
      setId: set.id,
      cleared,
      uploaded,
    };
  });

export interface ClearScreenshotsInput {
  readonly locale: string;
  /** Clear only this device's set; omit to clear every screenshot set for the locale. */
  readonly displayType?: AppleUtils.ScreenshotDisplayType;
}

/** Delete screenshots from a locale's set(s) on the editable version. */
export const clearScreenshots = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  platform: AppleUtils.Platform,
  input: ClearScreenshotsInput,
) =>
  Effect.gen(function* () {
    const version = yield* getEditableVersion(ctx, appId, platform);
    const localization = yield* findLocalization(version, input.locale);
    if (localization === null) {
      return { locale: input.locale, deleted: 0, sets: 0 };
    }
    const sets = yield* listScreenshotSets(localization);
    const targets =
      input.displayType === undefined
        ? sets
        : sets.filter((set) => set.attributes.screenshotDisplayType === input.displayType);
    let deleted = 0;
    for (const set of targets) {
      deleted += yield* deleteScreenshotsOf(ctx, set);
    }
    return { locale: input.locale, deleted, sets: targets.length };
  });

// ── previews upload ──────────────────────────────────────────────

export interface UploadPreviewInput {
  readonly locale: string;
  readonly previewType: AppleUtils.PreviewType;
  readonly filePath: string;
  /** Poster-frame time code, "HH:MM:SS:FF" (e.g. 00:00:05:01). */
  readonly frameTime?: string;
}

/** Upload a preview video into a locale + device set, waiting for Apple's transcode. */
export const uploadPreview = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  platform: AppleUtils.Platform,
  input: UploadPreviewInput,
) =>
  Effect.gen(function* () {
    const version = yield* getEditableVersion(ctx, appId, platform);
    const localization = yield* getOrCreateLocalization(version, input.locale);
    const set = yield* getOrCreatePreviewSet(localization, input.previewType);
    const preview = yield* wrapConnect("apple-upload-preview", async () =>
      set.uploadPreview(
        compact({
          filePath: input.filePath,
          waitForProcessing: true,
          previewFrameTimeCode: input.frameTime,
        }),
      ),
    );
    return {
      locale: input.locale,
      device: input.previewType,
      setId: set.id,
      previewId: preview.id,
      fileName: preview.attributes.fileName,
      state: previewState(preview),
    };
  });

// ── media sync ───────────────────────────────────────────────────

interface LocalDeviceSet {
  readonly displayType: AppleUtils.ScreenshotDisplayType;
  readonly files: readonly string[];
}

interface LocalLocale {
  readonly locale: string;
  readonly devices: readonly LocalDeviceSet[];
}

/** List the immediate sub-directory names of `dir`, sorted; readability errors surface clearly. */
const listSubdirectories = (dir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const entries = yield* fs.readDirectory(dir).pipe(
      Effect.mapError(
        (cause) =>
          new InvalidArgumentError({
            message: `Could not read directory "${dir}": ${String(cause)}`,
          }),
      ),
    );
    const subdirs: string[] = [];
    for (const name of [...entries].toSorted()) {
      const info = yield* fs.stat(path.join(dir, name)).pipe(Effect.orElseSucceed(() => null));
      if (info?.type === "Directory") {
        subdirs.push(name);
      }
    }
    return subdirs;
  });

/** Walk a `<root>/<locale>/<device>/*.png` tree into the per-locale device sets it declares. */
const walkLocalTree = (rootDir: string) =>
  Effect.gen(function* () {
    const localeNames = yield* listSubdirectories(rootDir);
    const locales: LocalLocale[] = [];
    for (const localeName of localeNames) {
      const localeDir = path.join(rootDir, localeName);
      const deviceNames = yield* listSubdirectories(localeDir);
      const devices: LocalDeviceSet[] = [];
      const seenTypes = new Set<AppleUtils.ScreenshotDisplayType>();
      for (const deviceName of deviceNames) {
        const displayType = yield* resolveScreenshotDisplayType(deviceName);
        // Two directories that resolve to the same device (e.g. `iphone-67` and
        // `APP_IPHONE_67`) would both target one remote set — reject the ambiguity
        // rather than delete + double-upload into it.
        if (seenTypes.has(displayType)) {
          return yield* new InvalidArgumentError({
            message: `Locale "${localeName}" has two directories that map to the same device "${displayType}". Keep only one.`,
          });
        }
        seenTypes.add(displayType);
        const files = yield* collectImages(path.join(localeDir, deviceName));
        if (files.length > 0) {
          devices.push({ displayType, files });
        }
      }
      if (devices.length > 0) {
        locales.push({ locale: localeName, devices });
      }
    }
    if (locales.length === 0) {
      return yield* new InvalidArgumentError({
        message: `No "<locale>/<device>/*.png" screenshots found under "${rootDir}".`,
      });
    }
    return locales;
  });

/** One planned/applied sync operation against a locale + device set. */
export interface SyncAction {
  readonly locale: string;
  readonly device: string;
  readonly action: "upload" | "replace" | "prune";
  readonly localFiles: number;
  readonly removedRemote: number;
}

export interface SyncMediaInput {
  readonly rootDir: string;
  /** Empty remote device sets that the local tree does not declare. */
  readonly prune: boolean;
  /** Compute and return the plan without mutating App Store Connect. */
  readonly dryRun: boolean;
}

/**
 * Declaratively sync a `screenshots/<locale>/<device>/*.png` tree to the editable
 * version: each local device set replaces its remote counterpart (the screenshots,
 * not the set, are deleted then re-uploaded). With `--prune`, remote device sets a
 * present locale does not declare locally are emptied. `--dry-run` returns the plan
 * only. Prune is scoped to locales present locally — a locale absent from the tree
 * is never touched.
 */
export const syncMedia = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  platform: AppleUtils.Platform,
  input: SyncMediaInput,
) =>
  Effect.gen(function* () {
    const localLocales = yield* walkLocalTree(input.rootDir);
    const version = yield* getEditableVersion(ctx, appId, platform);
    const actions: SyncAction[] = [];
    for (const localLocale of localLocales) {
      const localization = input.dryRun
        ? yield* findLocalization(version, localLocale.locale)
        : yield* getOrCreateLocalization(version, localLocale.locale);
      const remoteSets = localization === null ? [] : yield* listScreenshotSets(localization);
      const localTypes = new Set(localLocale.devices.map((device) => device.displayType));
      for (const device of localLocale.devices) {
        const remoteSet = remoteSets.find(
          (set) => set.attributes.screenshotDisplayType === device.displayType,
        );
        const removedRemote =
          remoteSet === undefined ? 0 : remoteSet.attributes.appScreenshots.length;
        actions.push({
          locale: localLocale.locale,
          device: device.displayType,
          action: remoteSet === undefined ? "upload" : "replace",
          localFiles: device.files.length,
          removedRemote,
        });
        // localization is non-null off the dry-run path (getOrCreate always resolves one).
        if (!input.dryRun && localization !== null) {
          const set = remoteSet ?? (yield* createScreenshotSet(localization, device.displayType));
          if (remoteSet !== undefined) {
            yield* deleteScreenshotsOf(ctx, remoteSet);
          }
          for (const file of device.files) {
            yield* uploadOneScreenshot(set, file);
          }
        }
      }
      if (input.prune) {
        const orphanSets = remoteSets.filter(
          (set) =>
            !localTypes.has(set.attributes.screenshotDisplayType) &&
            set.attributes.appScreenshots.length > 0,
        );
        for (const remoteSet of orphanSets) {
          actions.push({
            locale: localLocale.locale,
            device: remoteSet.attributes.screenshotDisplayType,
            action: "prune",
            localFiles: 0,
            removedRemote: remoteSet.attributes.appScreenshots.length,
          });
          if (!input.dryRun) {
            yield* deleteScreenshotsOf(ctx, remoteSet);
          }
        }
      }
    }
    return { dryRun: input.dryRun, prune: input.prune, actions };
  });
