/**
 * App Store **age-rating declaration** operations on the headless ASC
 * (`@expo/apple-utils`) entity layer. Backs `app-store age-rating get/set`. The
 * declaration has ~25 content fields, so `set` is authored from a JSON document
 * (`--from`) rather than a flag matrix; the two API-removed fields
 * (`gamblingAndContests`, `seventeenPlus`, both typed `never`) are never written.
 * Field VALUES are validated locally (like `privacy set`) before any write.
 */
import AppleUtils from "@expo/apple-utils";
import { Effect } from "effect";

import { wrapConnect } from "../lib/apple-asc-connect";
import { AppStoreError, InvalidArgumentError } from "../lib/exit-codes";
import { coerceEnum } from "./app-store-connect";
import { getApp } from "./app-store-versions";

/**
 * Each writable `AgeRatingDeclarationProps` field mapped to how its value is
 * validated: a string-enum object (members checked via {@link coerceEnum}),
 * `"boolean"`, or `"string"`. Excludes `gamblingAndContests` and `seventeenPlus`
 * (typed `never` — removed from the API; superseded by `gambling`+`contests` and
 * `ageRatingOverride`).
 */
const FIELD_SPECS: Record<string, object | "boolean" | "string"> = {
  alcoholTobaccoOrDrugUseOrReferences: AppleUtils.Rating,
  medicalOrTreatmentInformation: AppleUtils.Rating,
  profanityOrCrudeHumor: AppleUtils.Rating,
  sexualContentOrNudity: AppleUtils.Rating,
  gamblingSimulated: AppleUtils.Rating,
  horrorOrFearThemes: AppleUtils.Rating,
  matureOrSuggestiveThemes: AppleUtils.Rating,
  sexualContentGraphicAndNudity: AppleUtils.Rating,
  violenceCartoonOrFantasy: AppleUtils.Rating,
  violenceRealistic: AppleUtils.Rating,
  violenceRealisticProlongedGraphicOrSadistic: AppleUtils.Rating,
  contests: AppleUtils.Rating,
  gunsOrOtherWeapons: AppleUtils.Rating,
  kidsAgeBand: AppleUtils.KidsAgeBand,
  ageRatingOverride: AppleUtils.RatingOverride,
  ageRatingOverrideV2: AppleUtils.RatingOverrideV2,
  koreaAgeRatingOverride: AppleUtils.KoreaRatingOverride,
  unrestrictedWebAccess: "boolean",
  gambling: "boolean",
  lootBox: "boolean",
  advertising: "boolean",
  ageAssurance: "boolean",
  healthOrWellnessTopics: "boolean",
  messagingAndChat: "boolean",
  parentalControls: "boolean",
  userGeneratedContent: "boolean",
  developerAgeRatingInfoUrl: "string",
};

const WRITABLE_KEYS: readonly string[] = Object.keys(FIELD_SPECS);

/** Validate one authored field value against its {@link FIELD_SPECS} entry. */
const validateField = (
  key: string,
  value: unknown,
  spec: object | "boolean" | "string",
): Effect.Effect<void, InvalidArgumentError> => {
  if (spec === "boolean") {
    return typeof value === "boolean"
      ? Effect.void
      : Effect.fail(new InvalidArgumentError({ message: `--from ${key} must be true or false.` }));
  }
  if (spec === "string") {
    return typeof value === "string"
      ? Effect.void
      : Effect.fail(new InvalidArgumentError({ message: `--from ${key} must be a string.` }));
  }
  if (typeof value !== "string") {
    return Effect.fail(new InvalidArgumentError({ message: `--from ${key} must be a string.` }));
  }
  return coerceEnum<string>(spec, value, `--from ${key}`).pipe(Effect.asVoid);
};

/** Resolve the app's age-rating declaration (off the editable, then live, App Info). */
const getDeclaration = (ctx: AppleUtils.RequestContext, appId: string) =>
  Effect.gen(function* () {
    const app = yield* getApp(ctx, appId);
    const info = yield* wrapConnect("apple-get-app-info", async () => {
      const edit = await app.getEditAppInfoAsync();
      return edit ?? app.getLiveAppInfoAsync();
    });
    if (info === null) {
      return yield* new AppStoreError({ message: "No App Info found for this app." });
    }
    const declaration = yield* wrapConnect("apple-get-age-rating", async () =>
      info.getAgeRatingDeclarationAsync(),
    );
    if (declaration === null) {
      return yield* new AppStoreError({
        message: "No age-rating declaration found for this app.",
      });
    }
    return declaration;
  });

/** Read the age-rating declaration as a flat record of its non-empty fields. */
export const getAgeRating = (ctx: AppleUtils.RequestContext, appId: string) =>
  getDeclaration(ctx, appId).pipe(
    Effect.map((declaration) => ({
      id: declaration.id,
      declaration: Object.fromEntries(
        Object.entries(declaration.attributes).filter(
          ([, value]) => value !== null && value !== undefined,
        ),
      ),
    })),
  );

/**
 * Apply an age-rating declaration authored as JSON. Each field's value is
 * validated against its expected enum/type before any write; unknown keys (and
 * the two API-removed `never` fields) are ignored and reported, not rejected.
 */
export const setAgeRating = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  document: Record<string, unknown>,
) =>
  Effect.gen(function* () {
    const declaration = yield* getDeclaration(ctx, appId);
    const entries = Object.entries(document);
    const applied = entries.filter(([key]) => WRITABLE_KEYS.includes(key));
    const ignored = entries.filter(([key]) => !WRITABLE_KEYS.includes(key)).map(([key]) => key);
    if (applied.length === 0) {
      return yield* new AppStoreError({
        message: `No recognized age-rating fields in --from. Valid fields: ${WRITABLE_KEYS.join(", ")}.`,
      });
    }
    for (const [key, value] of applied) {
      yield* validateField(key, value, FIELD_SPECS[key] ?? "string");
    }
    const payload = Object.fromEntries(applied);
    yield* wrapConnect("apple-update-age-rating", async () =>
      declaration.updateAsync(payload as Parameters<typeof declaration.updateAsync>[0]),
    );
    return { id: declaration.id, applied: applied.map(([key]) => key), ignored };
  });
