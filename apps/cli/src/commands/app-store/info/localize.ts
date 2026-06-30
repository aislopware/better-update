import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { localizeAppInfo } from "../../../application/app-store-info";
import { runEffect } from "../../../lib/citty-effect";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

interface InfoLocalizeArgs extends AscCommonArgs {
  readonly locale?: string | undefined;
  readonly name?: string | undefined;
  readonly subtitle?: string | undefined;
  readonly "privacy-policy-url"?: string | undefined;
  readonly "privacy-choices-url"?: string | undefined;
  readonly "privacy-policy-text"?: string | undefined;
}

export const infoLocalizeCommand = defineCommand({
  meta: {
    name: "localize",
    description:
      "Set per-locale store listing (name, subtitle, privacy URLs) on the editable App Info",
  },
  args: {
    ...ASC_COMMON_ARGS,
    locale: { type: "string", description: "Locale to set, e.g. en-US (required)" },
    name: { type: "string", description: "App name shown on the store" },
    subtitle: { type: "string", description: "App subtitle" },
    "privacy-policy-url": { type: "string", description: "Privacy policy URL (submission prereq)" },
    "privacy-choices-url": { type: "string", description: "Privacy choices URL" },
    "privacy-policy-text": { type: "string", description: "Privacy policy text (tvOS)" },
  },
  run: async ({ args }: { readonly args: InfoLocalizeArgs }) =>
    runEffect(
      Effect.gen(function* () {
        if (args.locale === undefined || args.locale.trim().length === 0) {
          return yield* new InvalidArgumentError({ message: "--locale is required, e.g. en-US." });
        }
        const session = yield* openAscSession(args);
        const result = yield* localizeAppInfo(session.ctx, session.appId, {
          locale: args.locale.trim(),
          ...compact({
            name: args.name,
            subtitle: args.subtitle,
            privacyPolicyUrl: args["privacy-policy-url"],
            privacyChoicesUrl: args["privacy-choices-url"],
            privacyPolicyText: args["privacy-policy-text"],
          }),
        });
        yield* printHuman(
          `Updated ${result.locale} store listing (${result.fields.join(", ")}) on App Info ${result.appInfoId}.`,
        );
        return result;
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
