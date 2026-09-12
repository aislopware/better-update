import { compact } from "@better-update/type-guards";
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { ASC_COMMON_ARGS, openAscSession } from "../../../application/app-store-connect";
import { localizeAppInfo } from "../../../application/app-store-info";
import { printHuman } from "../../../lib/output";
import { optionalFlag } from "../../../lib/params";
import { runCommand } from "../../../lib/run-command";

export const infoLocalizeCommand = Command.make(
  "localize",
  {
    ...ASC_COMMON_ARGS,
    locale: Flag.String("locale").pipe(Flag.withDescription("Locale to set, e.g. en-US")),
    name: Flag.String("name").pipe(
      Flag.withDescription("App name shown on the store"),
      optionalFlag,
    ),
    subtitle: Flag.String("subtitle").pipe(Flag.withDescription("App subtitle"), optionalFlag),
    "privacy-policy-url": Flag.String("privacy-policy-url").pipe(
      Flag.withDescription("Privacy policy URL (submission prereq)"),
      optionalFlag,
    ),
    "privacy-choices-url": Flag.String("privacy-choices-url").pipe(
      Flag.withDescription("Privacy choices URL"),
      optionalFlag,
    ),
    "privacy-policy-text": Flag.String("privacy-policy-text").pipe(
      Flag.withDescription("Privacy policy text (tvOS)"),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Set per-locale store listing (name, subtitle, privacy URLs) on the editable App Info",
  ),
);
