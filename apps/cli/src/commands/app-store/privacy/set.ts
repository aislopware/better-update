import { compact } from "@better-update/type-guards";
import AppleUtils from "@expo/apple-utils";
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  coerceEnum,
  openAscSession,
} from "../../../application/app-store-connect";
import { setPrivacy } from "../../../application/app-store-privacy";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { asJsonArray, asJsonObject, readJsonInput } from "../../../lib/json-input";
import { printHuman } from "../../../lib/output";
import { optionalFlag } from "../../../lib/params";
import { runCommand } from "../../../lib/run-command";

import type { PrivacyRowInput } from "../../../application/app-store-privacy";

/** Validate an optional enum-id field on a privacy row (absent → undefined). */
const optionalRowEnum = <V extends string>(
  value: unknown,
  enumObject: object,
  label: string,
): Effect.Effect<V | undefined, InvalidArgumentError> =>
  Effect.gen(function* () {
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== "string") {
      return yield* new InvalidArgumentError({ message: `${label} must be a string.` });
    }
    return yield* coerceEnum<V>(enumObject, value.toUpperCase(), label);
  });

export const privacySetCommand = Command.make(
  "set",
  {
    ...ASC_COMMON_ARGS,
    from: Flag.String("from").pipe(
      Flag.withDescription(
        'JSON file path or inline JSON: an array of { "category", "protection"?, "purpose"? } (required)',
      ),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
      if (args.from === undefined || args.from.trim().length === 0) {
        return yield* new InvalidArgumentError({ message: "--from is required." });
      }
      const items = yield* asJsonArray(yield* readJsonInput(args.from), "--from usages");
      const rows: PrivacyRowInput[] = [];
      for (const [index, raw] of items.entries()) {
        const row = yield* asJsonObject(raw, `--from usages[${index}]`);
        const categoryRaw = row["category"];
        if (typeof categoryRaw !== "string") {
          return yield* new InvalidArgumentError({
            message: `usage ${index} requires a string "category".`,
          });
        }
        const category = yield* coerceEnum<AppleUtils.AppDataUsageCategoryId>(
          AppleUtils.AppDataUsageCategoryId,
          categoryRaw.toUpperCase(),
          `usages[${index}].category`,
        );
        const protection = yield* optionalRowEnum<AppleUtils.AppDataUsageDataProtectionId>(
          row["protection"],
          AppleUtils.AppDataUsageDataProtectionId,
          `usages[${index}].protection`,
        );
        const purpose = yield* optionalRowEnum<AppleUtils.AppDataUsagePurposeId>(
          row["purpose"],
          AppleUtils.AppDataUsagePurposeId,
          `usages[${index}].purpose`,
        );
        rows.push({ category, ...compact({ protection, purpose }) });
      }
      if (rows.length === 0) {
        return yield* new InvalidArgumentError({ message: "--from contained no data usages." });
      }
      const session = yield* openAscSession(args);
      const result = yield* setPrivacy(session.ctx, session.appId, rows);
      yield* printHuman(
        `Replaced App Privacy declarations (cleared ${String(result.cleared)}, created ${String(result.created)}). Run \`app-store privacy publish\` to make the label public.`,
      );
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Replace the App Privacy data usages from a JSON document, then publish to apply (--from)",
  ),
);
