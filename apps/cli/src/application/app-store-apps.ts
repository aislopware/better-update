/**
 * App Store Connect **app inventory + registration** on the `@expo/apple-utils`
 * entity layer. `listApps` (the account-scoped roster) is Token/CI-safe; `createApp`
 * registers a new app record and is **cookie-only** (App Manager role, Iris) — it
 * takes an Apple ID session. Backs `app-store apps list` / `app-store apps create`.
 */
import { compact, isRecord } from "@better-update/type-guards";
import AppleUtils from "@expo/apple-utils";
import { Effect } from "effect";

import { AppleConnectError, messageOf, wrapConnect } from "../lib/apple-asc-connect";

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

/** Apple's documented `App.createAsync` rejection codes → an actionable hint. */
const APP_CREATE_HINTS: Record<string, string> = {
  APP_CREATE_INSUFFICIENT_ROLE:
    'your Apple ID needs the "App Manager" or "Admin" role for this provider to create apps',
  APP_CREATE_BUNDLE_ID_NOT_REGISTERED:
    "register the bundle id in your Apple Developer account first (a build or `credentials` run does this)",
  APP_CREATE_NAME_UNAVAILABLE: "that app name is already taken on the App Store — choose another",
  APP_CREATE_NAME_INVALID: "the app name contains invalid characters",
};

/**
 * apple-utils sets the documented `APP_CREATE_*` constant on the error's `code`
 * (its `message` is human text that never contains the constant), so the hint must
 * be keyed off `code` — read here from the raw rejection before `messageOf` drops it.
 */
const appCreateErrorCode = (cause: unknown): string => {
  if (!isRecord(cause)) {
    return "";
  }
  const { code } = cause;
  return typeof code === "string" ? code : "";
};

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
    catch: (cause) => {
      const message = messageOf(cause);
      const hint = APP_CREATE_HINTS[appCreateErrorCode(cause)];
      return new AppleConnectError({
        step: "apple-create-app",
        message: hint === undefined ? message : `${message} — ${hint}.`,
      });
    },
  }).pipe(Effect.map(toView));
