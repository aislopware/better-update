/**
 * App Store Connect **pricing & availability** reads on the headless ASC
 * (`@expo/apple-utils`) entity layer. Backs `app-store pricing show` and
 * `app-store availability show`. Read-only and Token/CI-safe; the destructive
 * "set" counterparts are out of scope for this wave.
 */
import { toDbNull } from "@better-update/type-guards";
import { Effect } from "effect";

import type AppleUtils from "@expo/apple-utils";

import { wrapConnect } from "../lib/apple-asc-connect";
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
