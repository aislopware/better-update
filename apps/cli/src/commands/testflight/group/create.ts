import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { createBetaGroup } from "../../../application/testflight-groups";
import { runEffect } from "../../../lib/citty-effect";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman, printHumanKeyValue } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

interface GroupCreateArgs extends AscCommonArgs {
  readonly name?: string | undefined;
  readonly internal: boolean;
  readonly "public-link": boolean;
  readonly "public-link-limit"?: string | undefined;
}

export const groupCreateCommand = defineCommand({
  meta: {
    name: "create",
    description:
      "Create a TestFlight beta group (internal by default) — the group `submit ios` assigns builds to",
  },
  args: {
    ...ASC_COMMON_ARGS,
    name: { type: "string", description: "Name of the beta group to create (required)" },
    internal: {
      type: "boolean",
      default: true,
      description: "Create an internal group (App Store Connect users only; default)",
      negativeDescription: "Create an external group (public testers, requires beta review)",
    },
    "public-link": {
      type: "boolean",
      default: false,
      description: "Enable a public TestFlight invite link (external groups only)",
    },
    "public-link-limit": {
      type: "string",
      description: "Cap the number of testers who can join via the public link (1–10000)",
    },
  },
  run: async ({ args }: { readonly args: GroupCreateArgs }) =>
    runEffect(
      Effect.gen(function* () {
        if (args.name === undefined || args.name.trim().length === 0) {
          return yield* new InvalidArgumentError({ message: "--name is required." });
        }
        const limit = yield* parseLimit(args["public-link-limit"]);
        const session = yield* openAscSession(args);
        const created = yield* createBetaGroup(session.ctx, session.appId, {
          name: args.name.trim(),
          internal: args.internal,
          publicLinkEnabled: args["public-link"],
          publicLinkLimit: limit,
        });
        yield* printHuman(
          `Created ${created.internal ? "internal" : "external"} TestFlight group "${created.name}".`,
        );
        yield* printHumanKeyValue([
          ["Name", created.name],
          ["Type", created.internal ? "internal" : "external"],
          ["ID", created.id],
          ["Public link", created.publicLink ?? "—"],
        ]);
        return created;
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});

const parseLimit = (
  raw: string | undefined,
): Effect.Effect<number | undefined, InvalidArgumentError> => {
  if (raw === undefined) {
    return Effect.succeed(undefined);
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 10_000) {
    return Effect.fail(
      new InvalidArgumentError({
        message: `--public-link-limit must be an integer between 1 and 10000, got "${raw}".`,
      }),
    );
  }
  return Effect.succeed(value);
};
