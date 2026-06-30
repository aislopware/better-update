/**
 * TestFlight **build** operations on the headless ASC (`@expo/apple-utils`)
 * entity layer: set per-locale "What to Test" notes on a build, and assign a
 * build to beta groups. Backs `testflight build whats-new` and
 * `testflight group add-build`. The build entity is resolved via
 * {@link resolveBuild} (app-store-versions). All Token/CI-safe.
 */
import AppleUtils from "@expo/apple-utils";
import { Effect } from "effect";

import { wrapConnect } from "../lib/apple-asc-connect";

/** A beta-build localization projected to the fields the CLI surfaces. */
export interface BuildLocalizationView {
  readonly buildId: string;
  readonly locale: string;
  readonly whatsNew: string | null;
}

/**
 * Set the "What to Test" notes for a locale on a build, creating the localization
 * if the build has none for that locale yet (Apple's `createAsync` takes only the
 * locale, so the text is written in a follow-up update).
 */
export const setBuildWhatsNew = (
  ctx: AppleUtils.RequestContext,
  build: AppleUtils.Build,
  locale: string,
  whatsNew: string,
) =>
  Effect.gen(function* () {
    const localizations = yield* wrapConnect("apple-list-beta-build-localizations", async () =>
      build.getBetaBuildLocalizationsAsync(),
    );
    const existing = localizations.find((loc) => loc.attributes.locale === locale);
    const target =
      existing ??
      (yield* wrapConnect("apple-create-beta-build-localization", async () =>
        AppleUtils.BetaBuildLocalization.createAsync(ctx, { id: build.id, locale }),
      ));
    const updated = yield* wrapConnect("apple-update-beta-build-localization", async () =>
      target.updateAsync({ whatsNew }),
    );
    return {
      buildId: build.id,
      locale: updated.attributes.locale ?? locale,
      whatsNew: updated.attributes.whatsNew,
    } satisfies BuildLocalizationView;
  });

/** Assign a build to one or more beta groups (by group id). */
export const addBuildToGroups = (build: AppleUtils.Build, betaGroupIds: readonly string[]) =>
  wrapConnect("apple-add-build-to-groups", async () =>
    build.addBetaGroupsAsync({ betaGroups: [...betaGroupIds] }),
  );
