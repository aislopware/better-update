/**
 * App Store **App Privacy** (data-usage / "nutrition label") operations on the
 * headless ASC (`@expo/apple-utils`) entity layer. Backs `app-store privacy
 * get/set/publish/clear`. Apple stores one `(category, single relationship)` row
 * per `createAppDataUsageAsync` call, so `set` is declarative: clear the existing
 * rows, then create one per authored triple. All Token/CI-safe.
 */
import { compact, toDbNull } from "@better-update/type-guards";
import { Effect } from "effect";

import type AppleUtils from "@expo/apple-utils";

import { wrapConnect } from "../lib/apple-asc-connect";
import { AppStoreError } from "../lib/exit-codes";
import { getApp } from "./app-store-versions";

/** One declared data-usage row projected to the fields the CLI surfaces. */
export interface DataUsageRow {
  readonly id: string;
  readonly category: string | null;
  readonly protection: string | null;
  readonly purpose: string | null;
}

export interface PrivacyView {
  readonly published: boolean;
  readonly lastPublished: string | null;
  readonly usages: readonly DataUsageRow[];
}

/** Read the declared App Privacy data usages + publish state. */
export const getPrivacy = (ctx: AppleUtils.RequestContext, appId: string) =>
  Effect.gen(function* () {
    const app = yield* getApp(ctx, appId);
    const [usages, publishStates] = yield* wrapConnect("apple-get-privacy", async () =>
      Promise.all([app.getAppDataUsagesAsync(), app.getAppDataUsagesPublishStateAsync()] as const),
    );
    const [publishState] = publishStates;
    return {
      published: publishState?.attributes.published ?? false,
      lastPublished: toDbNull(publishState?.attributes.lastPublished),
      usages: usages.map(
        (usage): DataUsageRow => ({
          id: usage.id,
          category: toDbNull(usage.attributes.category?.id),
          protection: toDbNull(usage.attributes.dataProtection?.id),
          purpose: toDbNull(usage.attributes.purpose?.id),
        }),
      ),
    } satisfies PrivacyView;
  });

/** A validated data-usage triple authored in the `set` JSON document. */
export interface PrivacyRowInput {
  readonly category?: AppleUtils.AppDataUsageCategoryId;
  readonly protection?: AppleUtils.AppDataUsageDataProtectionId;
  readonly purpose?: AppleUtils.AppDataUsagePurposeId;
}

/**
 * Replace the App Privacy declarations with the authored rows: delete every
 * existing usage, then create one per row. The label still needs `publish` to
 * become public.
 */
export const setPrivacy = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  rows: readonly PrivacyRowInput[],
) =>
  Effect.gen(function* () {
    const app = yield* getApp(ctx, appId);
    const existing = yield* wrapConnect("apple-get-privacy", async () =>
      app.getAppDataUsagesAsync(),
    );
    yield* Effect.forEach(
      existing,
      (usage) => wrapConnect("apple-delete-privacy", async () => usage.deleteAsync()),
      { discard: true },
    );
    yield* Effect.forEach(
      rows,
      (row) =>
        wrapConnect("apple-create-privacy", async () =>
          app.createAppDataUsageAsync(
            compact({
              appDataUsageCategory: row.category,
              appDataUsageProtection: row.protection,
              appDataUsagePurpose: row.purpose,
            }),
          ),
        ),
      { discard: true },
    );
    return { cleared: existing.length, created: rows.length };
  });

/** Toggle the App Privacy label's publish state (makes the label public). */
export const publishPrivacy = (ctx: AppleUtils.RequestContext, appId: string, published: boolean) =>
  Effect.gen(function* () {
    const app = yield* getApp(ctx, appId);
    const states = yield* wrapConnect("apple-get-privacy-publish-state", async () =>
      app.getAppDataUsagesPublishStateAsync(),
    );
    const [state] = states;
    if (state === undefined) {
      return yield* new AppStoreError({
        message: "No App Privacy publish state found for this app.",
      });
    }
    const updated = yield* wrapConnect("apple-update-privacy-publish-state", async () =>
      state.updateAsync({ published }),
    );
    return { published: updated.attributes.published };
  });

/** Delete every declared App Privacy data usage (re-publish afterwards to apply). */
export const clearPrivacy = (ctx: AppleUtils.RequestContext, appId: string) =>
  Effect.gen(function* () {
    const app = yield* getApp(ctx, appId);
    const existing = yield* wrapConnect("apple-get-privacy", async () =>
      app.getAppDataUsagesAsync(),
    );
    yield* Effect.forEach(
      existing,
      (usage) => wrapConnect("apple-delete-privacy", async () => usage.deleteAsync()),
      { discard: true },
    );
    return { cleared: existing.length };
  });
