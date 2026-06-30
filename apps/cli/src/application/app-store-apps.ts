/**
 * App Store Connect **app inventory** on the headless ASC (`@expo/apple-utils`)
 * entity layer. Backs `app-store apps list` — the account-scoped roster of every
 * app the ASC API key can see. Token/CI-safe.
 */
import AppleUtils from "@expo/apple-utils";
import { Effect } from "effect";

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
