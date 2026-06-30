import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_AUTH_ARGS,
  openAscContext,
} from "../../../application/app-store-connect";
import {
  createAppClipBundleId,
  createBundleId,
  resolveBundleId,
} from "../../../application/apple-signing-inventory";
import { openCookieContext } from "../../../application/asc-cookie-session";
import { runEffect } from "../../../lib/citty-effect";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman, printHumanKeyValue } from "../../../lib/output";

import type { AscAuthArgs } from "../../../application/app-store-connect";

interface BundleIdCreateArgs extends AscAuthArgs {
  readonly identifier?: string | undefined;
  readonly name?: string | undefined;
  readonly "app-clip": boolean;
  readonly parent?: string | undefined;
}

export const bundleIdCreateCommand = defineCommand({
  meta: {
    name: "create",
    description:
      "Register a new App ID (bundle id). Regular App IDs are CI-safe (ASC API key); --app-clip needs an Apple ID login.",
  },
  args: {
    ...ASC_AUTH_ARGS,
    identifier: {
      type: "string",
      description: "Bundle id to register, e.g. com.acme.app (required)",
    },
    name: { type: "string", description: "Display name (defaults to the identifier)" },
    "app-clip": {
      type: "boolean",
      default: false,
      description: "Create an App Clip App ID under --parent (requires an Apple ID login)",
    },
    parent: {
      type: "string",
      description:
        "Parent App ID's bundle id (required with --app-clip; App Clips are {parent}.Clip)",
    },
  },
  run: async ({ args }: { readonly args: BundleIdCreateArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const identifier = args.identifier?.trim();
        if (identifier === undefined || identifier.length === 0) {
          return yield* new InvalidArgumentError({
            message: "--identifier is required (e.g. com.acme.app).",
          });
        }
        const created = yield* args["app-clip"]
          ? Effect.gen(function* () {
              const parent = args.parent?.trim();
              if (parent === undefined || parent.length === 0) {
                return yield* new InvalidArgumentError({
                  message: "--parent is required with --app-clip (the parent App ID's bundle id).",
                });
              }
              const { ctx } = yield* openCookieContext;
              const parentBundleId = yield* resolveBundleId(ctx, {
                id: undefined,
                identifier: parent,
              });
              return yield* createAppClipBundleId(ctx, {
                identifier,
                parentBundleIdId: parentBundleId.id,
                ...compact({ name: args.name }),
              });
            })
          : Effect.gen(function* () {
              const { ctx } = yield* openAscContext(args);
              return yield* createBundleId(ctx, { identifier, ...compact({ name: args.name }) });
            });
        yield* printHuman(`Registered App ID ${created.identifier}.`);
        yield* printHumanKeyValue([
          ["ID", created.id],
          ["Identifier", created.identifier],
          ["Name", created.name],
          ["Platform", created.platform],
        ]);
        return created;
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
