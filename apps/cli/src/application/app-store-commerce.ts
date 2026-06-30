/**
 * App Store Connect **pricing & availability** on the headless ASC
 * (`@expo/apple-utils`) entity layer. Backs `app-store pricing show`,
 * `app-store availability show/set`, and `app-store territories`. All Token/CI-safe.
 * Pricing stays read-only (set requires a signed Paid Apps Agreement and replaces
 * the whole schedule — out of scope); availability uses the deprecated-but-working
 * `App.updateAsync({ territories })` path rather than a hand-rolled raw `/v2` POST.
 */
import { toDbNull } from "@better-update/type-guards";
// @expo/apple-utils is ncc-bundled CJS; the `Territory`/`App` managers are read off
// the default import (see apple-asc-connect.ts for the rationale).
import AppleUtils from "@expo/apple-utils";
import { Effect } from "effect";

import { wrapConnect } from "../lib/apple-asc-connect";
import { AppStoreError } from "../lib/exit-codes";
import { getApp } from "./app-store-versions";

/** One manual price row of a price schedule (the price amount lives on the price point). */
export interface PriceRow {
  readonly territory: string | null;
  readonly pricePoint: string | null;
  readonly startDate: string | null;
}

/** An app's current price schedule, or `hasSchedule=false` when never priced. */
export interface PricingView {
  readonly hasSchedule: boolean;
  readonly baseTerritory: string | null;
  readonly manualPrices: readonly PriceRow[];
  readonly automaticPriceCount: number;
}

const priceRow = (price: AppleUtils.AppPrice): PriceRow => ({
  territory: toDbNull(price.attributes.territory?.id),
  pricePoint: toDbNull(price.attributes.appPricePoint?.id),
  startDate: toDbNull(price.attributes.startDate),
});

/** Read the app's current price schedule (base territory + manually-set prices). */
export const showPricing = (ctx: AppleUtils.RequestContext, appId: string) =>
  Effect.gen(function* () {
    const app = yield* getApp(ctx, appId);
    const schedule = yield* wrapConnect("apple-get-price-schedule", async () =>
      app.getPriceScheduleAsync(),
    );
    if (schedule === null) {
      return {
        hasSchedule: false,
        baseTerritory: null,
        manualPrices: [],
        automaticPriceCount: 0,
      } satisfies PricingView;
    }
    return {
      hasSchedule: true,
      baseTerritory: toDbNull(schedule.attributes.baseTerritory?.id),
      manualPrices: (schedule.attributes.manualPrices ?? []).map(priceRow),
      automaticPriceCount: (schedule.attributes.automaticPrices ?? []).length,
    } satisfies PricingView;
  });

/** One territory the app is (or can be) available in. */
export interface TerritoryRow {
  readonly id: string;
  readonly currency: string;
}

/** List the territories the app is currently available in (~175 worldwide). */
export const showAvailability = (ctx: AppleUtils.RequestContext, appId: string) =>
  Effect.gen(function* () {
    const app = yield* getApp(ctx, appId);
    const territories = yield* wrapConnect("apple-get-available-territories", async () =>
      app.getAvailableTerritoriesAsync(),
    );
    return territories.map(
      (territory): TerritoryRow => ({ id: territory.id, currency: territory.attributes.currency }),
    );
  });

/** List every App Store territory id + currency (the reference set for `availability set`). */
export const listAllTerritories = (ctx: AppleUtils.RequestContext) =>
  wrapConnect("apple-list-territories", async () => AppleUtils.Territory.getAsync(ctx)).pipe(
    Effect.map((territories) =>
      territories.map(
        (territory): TerritoryRow => ({
          id: territory.id,
          currency: territory.attributes.currency,
        }),
      ),
    ),
  );

export interface SetAvailabilityInput {
  /** Full replacement set of territory ids. Mutually exclusive with add/remove. */
  readonly replace?: readonly string[];
  readonly add?: readonly string[];
  readonly remove?: readonly string[];
}

export interface SetAvailabilityResult {
  readonly count: number;
  readonly territories: readonly string[];
}

/**
 * Set the app's territory availability via `App.updateAsync({ territories })`. Either
 * replace the whole set (`replace`) or read-modify-write the current set (`add`/
 * `remove`). Refuses an empty result (which would delist the app worldwide).
 */
export const setAvailability = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  input: SetAvailabilityInput,
) =>
  Effect.gen(function* () {
    const next = yield* Effect.gen(function* () {
      if (input.replace !== undefined) {
        return [...new Set(input.replace)];
      }
      const app = yield* getApp(ctx, appId);
      const current = yield* wrapConnect("apple-get-available-territories", async () =>
        app.getAvailableTerritoriesAsync(),
      );
      const ids = new Set(current.map((territory) => territory.id));
      for (const id of input.add ?? []) {
        ids.add(id);
      }
      for (const id of input.remove ?? []) {
        ids.delete(id);
      }
      return [...ids];
    });
    if (next.length === 0) {
      return yield* new AppStoreError({
        message:
          "Refusing to set zero territories (that would delist the app everywhere). Pass at least one territory.",
      });
    }
    yield* wrapConnect("apple-update-availability", async () =>
      AppleUtils.App.updateAsync(ctx, { id: appId, territories: next }),
    );
    return { count: next.length, territories: next } satisfies SetAvailabilityResult;
  });
