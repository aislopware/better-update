/**
 * App Store **App Info** operations on the headless ASC (`@expo/apple-utils`)
 * entity layer: the store-listing metadata that lives on `AppInfo` (store name,
 * subtitle, privacy-policy URL, categories) — distinct from the per-version
 * `AppStoreVersionLocalization`. Backs `app-store info` + `app-store categories`.
 */
import { compact, toDbNull } from "@better-update/type-guards";
import AppleUtils from "@expo/apple-utils";
import { Effect } from "effect";

import { wrapConnect } from "../lib/apple-asc-connect";
import { AppStoreError } from "../lib/exit-codes";
import { getApp } from "./app-store-versions";

/** Resolve the editable `AppInfo` (the in-prep draft), failing when there is none. */
const getEditableAppInfo = (ctx: AppleUtils.RequestContext, appId: string) =>
  Effect.gen(function* () {
    const app = yield* getApp(ctx, appId);
    const info = yield* wrapConnect("apple-get-edit-app-info", async () =>
      app.getEditAppInfoAsync(),
    );
    if (info === null) {
      return yield* new AppStoreError({
        message:
          "No editable App Info found (no version in 'Prepare for Submission'). Create an editable version first with `better-update app-store version create`.",
      });
    }
    return info;
  });

export interface AppInfoLocalizationView {
  readonly locale: string;
  readonly name: string | null;
  readonly subtitle: string | null;
  readonly privacyPolicyUrl: string | null;
}

export interface AppInfoView {
  readonly appInfoId: string;
  readonly state: string | null;
  readonly primaryCategory: string | null;
  readonly secondaryCategory: string | null;
  readonly localizations: readonly AppInfoLocalizationView[];
}

/** Read the app's store info + per-locale listing, preferring the editable draft. */
export const showAppInfo = (ctx: AppleUtils.RequestContext, appId: string) =>
  Effect.gen(function* () {
    const app = yield* getApp(ctx, appId);
    const info = yield* wrapConnect("apple-get-app-info", async () => {
      const edit = await app.getEditAppInfoAsync();
      return edit ?? app.getLiveAppInfoAsync();
    });
    if (info === null) {
      return yield* new AppStoreError({ message: "No App Info found for this app." });
    }
    const localizations = yield* wrapConnect("apple-list-app-info-localizations", async () =>
      info.getLocalizationsAsync(),
    );
    return {
      appInfoId: info.id,
      state: info.attributes.state,
      primaryCategory: toDbNull(info.attributes.primaryCategory?.id),
      secondaryCategory: toDbNull(info.attributes.secondaryCategory?.id),
      localizations: localizations.map(
        (loc): AppInfoLocalizationView => ({
          locale: loc.attributes.locale,
          name: loc.attributes.name,
          subtitle: loc.attributes.subtitle,
          privacyPolicyUrl: loc.attributes.privacyPolicyUrl,
        }),
      ),
    } satisfies AppInfoView;
  });

export interface LocalizeAppInfoInput {
  readonly locale: string;
  readonly name?: string;
  readonly subtitle?: string;
  readonly privacyPolicyUrl?: string;
  readonly privacyChoicesUrl?: string;
  readonly privacyPolicyText?: string;
}

/**
 * Set per-locale store-listing metadata (name, subtitle, privacy URLs) on the
 * editable App Info, creating the localization if the app has none for the locale.
 */
export const localizeAppInfo = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  input: LocalizeAppInfoInput,
) =>
  Effect.gen(function* () {
    const info = yield* getEditableAppInfo(ctx, appId);
    const localizations = yield* wrapConnect("apple-list-app-info-localizations", async () =>
      info.getLocalizationsAsync(),
    );
    const existing = localizations.find((loc) => loc.attributes.locale === input.locale);
    const attributes = compact({
      name: input.name,
      subtitle: input.subtitle,
      privacyPolicyUrl: input.privacyPolicyUrl,
      privacyChoicesUrl: input.privacyChoicesUrl,
      privacyPolicyText: input.privacyPolicyText,
    });
    if (Object.keys(attributes).length === 0) {
      return yield* new AppStoreError({
        message:
          "Nothing to set. Pass at least one of --name, --subtitle, --privacy-policy-url, --privacy-choices-url, --privacy-policy-text.",
      });
    }
    const target =
      existing ??
      (yield* wrapConnect("apple-create-app-info-localization", async () =>
        info.createLocalizationAsync({ locale: input.locale }),
      ));
    yield* wrapConnect("apple-update-app-info-localization", async () =>
      target.updateAsync(attributes),
    );
    return { locale: input.locale, appInfoId: info.id, fields: Object.keys(attributes) };
  });

/** The validated category-id selection passed to {@link setCategories}. */
export interface CategorySelection {
  readonly primaryCategory?: AppleUtils.AppCategoryId;
  readonly primarySubcategoryOne?: AppleUtils.AppSubcategoryId;
  readonly primarySubcategoryTwo?: AppleUtils.AppSubcategoryId;
  readonly secondaryCategory?: AppleUtils.AppCategoryId;
  readonly secondarySubcategoryOne?: AppleUtils.AppSubcategoryId;
  readonly secondarySubcategoryTwo?: AppleUtils.AppSubcategoryId;
}

/** Set the App Store primary/secondary categories (and subcategories) on the App Info. */
export const setCategories = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  selection: CategorySelection,
) =>
  Effect.gen(function* () {
    const info = yield* getEditableAppInfo(ctx, appId);
    const updated = yield* wrapConnect("apple-update-categories", async () =>
      info.updateCategoriesAsync(selection),
    );
    return {
      appInfoId: updated.id,
      primaryCategory: toDbNull(updated.attributes.primaryCategory?.id),
      secondaryCategory: toDbNull(updated.attributes.secondaryCategory?.id),
    };
  });

export interface CategoryView {
  readonly id: string;
  readonly platforms: readonly string[];
}

/** List the valid App Store category ids for a platform (a static reference catalog). */
export const listCategories = (
  ctx: AppleUtils.RequestContext,
  platform: AppleUtils.BundleIdPlatform,
) =>
  wrapConnect("apple-list-categories", async () =>
    AppleUtils.AppCategory.getAsync(ctx, {
      query: { filter: { platforms: [platform] }, limit: 200 },
    }),
  ).pipe(
    Effect.map((categories) =>
      categories.map(
        (category): CategoryView => ({
          id: category.id,
          platforms: category.attributes.platforms,
        }),
      ),
    ),
  );
