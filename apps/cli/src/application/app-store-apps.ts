/**
 * App Store Connect **app inventory + registration** on the `@expo/apple-utils`
 * entity layer. `listApps` (the account-scoped roster) is Token/CI-safe; `createApp`
 * registers a new app record and is **cookie-only** (App Manager role, Iris) — it
 * takes an Apple ID session. Backs `app-store apps list` / `app-store apps create`.
 */
import { compact } from "@better-update/type-guards";
import AppleUtils from "@expo/apple-utils";
import { Effect } from "effect";

import { mapAppCreateError } from "../lib/apple-app-create-error";
import { wrapConnect } from "../lib/apple-asc-connect";

/** An app record projected to the fields the CLI surfaces. */
export interface AppView {
  readonly id: string;
  readonly name: string;
  readonly bundleId: string;
  readonly sku: string;
  readonly primaryLocale: string;
}

const toView = (app: AppleUtils.App): AppView => ({
  id: app.id,
  name: app.attributes.name,
  bundleId: app.attributes.bundleId,
  sku: app.attributes.sku,
  primaryLocale: app.attributes.primaryLocale,
});

/** List every app the authenticated ASC API key can see (account-scoped). */
export const listApps = (ctx: AppleUtils.RequestContext) =>
  wrapConnect("apple-list-apps", async () => AppleUtils.App.getAsync(ctx)).pipe(
    Effect.map((apps) => apps.map(toView)),
  );

export interface CreateAppInput {
  readonly name: string;
  readonly bundleIdentifier: string;
  readonly sku?: string;
  readonly primaryLocale?: string;
  readonly companyName?: string;
  readonly platforms?: readonly AppleUtils.Platform[];
}

/**
 * Register a new App Store Connect app record (cookie/Iris, App Manager role). The
 * bundle id must already be registered on the Developer Portal. Apple's documented
 * rejection codes are surfaced with an actionable hint.
 */
export const createApp = (ctx: AppleUtils.RequestContext, input: CreateAppInput) =>
  Effect.tryPromise({
    try: async () =>
      AppleUtils.App.createAsync(
        ctx,
        compact({
          name: input.name,
          bundleId: input.bundleIdentifier,
          sku: input.sku ?? input.bundleIdentifier,
          primaryLocale: input.primaryLocale ?? "en-US",
          companyName: input.companyName,
          platforms:
            input.platforms === undefined ? [AppleUtils.Platform.IOS] : [...input.platforms],
        }),
      ),
    catch: mapAppCreateError,
  }).pipe(Effect.map(toView));
