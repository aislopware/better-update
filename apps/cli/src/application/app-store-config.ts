/**
 * App Store **metadata config** aggregator (the `eas metadata` parity slice) on the
 * `@expo/apple-utils` entity layer. Backs `app-store config pull/push`: read the
 * editable version's per-locale copy (release notes / description / keywords /
 * promo / URLs) to a JSON document, and apply such a document back. Token/CI-safe.
 *
 * Scope is deliberately the per-version localization copy only — pricing,
 * age-rating, privacy, and screenshots are owned by their own granular commands and
 * stay out of this document (mirrors `eas metadata`'s split).
 */
import { compact, toOptional } from "@better-update/type-guards";
import { Effect } from "effect";

import type AppleUtils from "@expo/apple-utils";

import { wrapConnect } from "../lib/apple-asc-connect";
import { AppStoreError, InvalidArgumentError } from "../lib/exit-codes";
import { asJsonArray, asJsonObject } from "../lib/json-input";
import { getEditableVersion, localizeVersion } from "./app-store-versions";

/** One locale's copy in the config document. */
export interface LocalizationDoc {
  readonly locale: string;
  readonly whatsNew?: string;
  readonly description?: string;
  readonly keywords?: string;
  readonly promotionalText?: string;
  readonly marketingUrl?: string;
  readonly supportUrl?: string;
}

/** The full pulled/pushed config document. */
export interface ConfigDoc {
  readonly versionString: string;
  readonly localizations: readonly LocalizationDoc[];
}

const COPY_FIELDS = [
  "whatsNew",
  "description",
  "keywords",
  "promotionalText",
  "marketingUrl",
  "supportUrl",
] as const;

/** Pull the editable version's per-locale copy into a config document. */
export const pullConfig = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  platform: AppleUtils.Platform,
) =>
  Effect.gen(function* () {
    const version = yield* getEditableVersion(ctx, appId, platform);
    const localizations = yield* wrapConnect("apple-list-localizations", async () =>
      version.getLocalizationsAsync(),
    );
    return {
      versionString: version.attributes.versionString,
      localizations: localizations.map(
        (loc): LocalizationDoc =>
          compact({
            locale: loc.attributes.locale,
            whatsNew: toOptional(loc.attributes.whatsNew),
            description: toOptional(loc.attributes.description),
            keywords: toOptional(loc.attributes.keywords),
            promotionalText: toOptional(loc.attributes.promotionalText),
            marketingUrl: toOptional(loc.attributes.marketingUrl),
            supportUrl: toOptional(loc.attributes.supportUrl),
          }),
      ),
    } satisfies ConfigDoc;
  });

/** Read one copy field as an optional string, rejecting non-string values. */
const readField = (
  source: Record<string, unknown>,
  key: string,
): Effect.Effect<string | undefined, InvalidArgumentError> => {
  const value = source[key];
  if (value === undefined || value === null) {
    return Effect.succeed(undefined);
  }
  if (typeof value !== "string") {
    return Effect.fail(
      new InvalidArgumentError({ message: `Config field "${key}" must be a string.` }),
    );
  }
  return Effect.succeed(value);
};

/** Parse one localization entry from the pushed document. */
const parseLocalization = (entry: unknown, index: number) =>
  Effect.gen(function* () {
    const object = yield* asJsonObject(entry, `localizations[${index}]`);
    const locale = yield* readField(object, "locale");
    if (locale === undefined || locale.trim().length === 0) {
      return yield* new InvalidArgumentError({
        message: `localizations[${index}] is missing a "locale".`,
      });
    }
    const copy: Record<string, string | undefined> = {};
    for (const field of COPY_FIELDS) {
      copy[field] = yield* readField(object, field);
    }
    return { locale: locale.trim(), copy } as const;
  });

export interface PushConfigResult {
  readonly applied: number;
  readonly locales: readonly string[];
  readonly skipped: readonly string[];
}

/**
 * Apply a config document to the editable version: set each locale's copy via
 * {@link localizeVersion}. Locales whose entry carries no copy fields are skipped
 * (reported), so a round-tripped pull→push of an empty locale is a no-op.
 */
export const pushConfig = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  platform: AppleUtils.Platform,
  document: unknown,
) =>
  Effect.gen(function* () {
    const root = yield* asJsonObject(document, "config");
    const rawLocalizations = yield* asJsonArray(root["localizations"], "config.localizations");
    const entries = yield* Effect.all(
      rawLocalizations.map((entry, index) => parseLocalization(entry, index)),
    );
    if (entries.length === 0) {
      return yield* new AppStoreError({
        message: "config.localizations is empty — nothing to push.",
      });
    }
    const applied: string[] = [];
    const skipped: string[] = [];
    for (const entry of entries) {
      const fields = compact(entry.copy);
      if (Object.keys(fields).length === 0) {
        skipped.push(entry.locale);
      } else {
        yield* localizeVersion(ctx, appId, platform, { locale: entry.locale, ...fields });
        applied.push(entry.locale);
      }
    }
    return { applied: applied.length, locales: applied, skipped } satisfies PushConfigResult;
  });
