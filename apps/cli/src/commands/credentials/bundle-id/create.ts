import { compact } from "@better-update/type-guards";
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { ASC_AUTH_ARGS, openAscContext } from "../../../application/app-store-connect";
import {
  createAppClipBundleId,
  createBundleId,
  resolveBundleId,
} from "../../../application/apple-signing-inventory";
import { openCookieContext } from "../../../application/asc-cookie-session";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman, printHumanKeyValue } from "../../../lib/output";
import { optionalFlag } from "../../../lib/params";
import { runCommand } from "../../../lib/run-command";

export const bundleIdCreateCommand = Command.make(
  "create",
  {
    ...ASC_AUTH_ARGS,
    identifier: Flag.String("identifier").pipe(
      Flag.withDescription("Bundle id to register, e.g. com.acme.app"),
    ),
    name: Flag.String("name").pipe(
      Flag.withDescription("Display name (defaults to the identifier)"),
      optionalFlag,
    ),
    "app-clip": Flag.Boolean("app-clip").pipe(
      Flag.withDescription("Create an App Clip App ID under --parent (requires an Apple ID login)"),
      Flag.withDefault(false),
    ),
    parent: Flag.String("parent").pipe(
      Flag.withDescription(
        "Parent App ID's bundle id (required with --app-clip; App Clips are {parent}.Clip)",
      ),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
      const identifier = args.identifier.trim();
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Register a new App ID (bundle id). Regular App IDs are CI-safe (ASC API key); --app-clip needs an Apple ID login.",
  ),
);
