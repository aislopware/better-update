import { Effect, Schema } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { ASC_COMMON_ARGS, openAscSession } from "../../../application/app-store-connect";
import { createBetaGroup } from "../../../application/testflight-groups";
import { printHuman, printHumanKeyValue } from "../../../lib/output";
import { optionalFlag } from "../../../lib/params";
import { runCommand } from "../../../lib/run-command";

const PublicLinkLimit = Schema.NumberFromString.check(
  Schema.isInt({ message: "Expected a whole number" }),
  Schema.isBetween(
    { minimum: 1, maximum: 10_000 },
    { message: "Expected a number between 1 and 10000" },
  ),
);

export const groupCreateCommand = Command.make(
  "create",
  {
    ...ASC_COMMON_ARGS,
    name: Flag.String("name").pipe(Flag.withDescription("Name of the beta group to create")),
    internal: Flag.Boolean("internal").pipe(
      Flag.withDescription(
        "Create an internal group (App Store Connect users only; default) (--no-internal: Create an external group (public testers, requires beta review))",
      ),
      Flag.withDefault(true),
    ),
    "public-link": Flag.Boolean("public-link").pipe(
      Flag.withDescription("Enable a public TestFlight invite link (external groups only)"),
      Flag.withDefault(false),
    ),
    "public-link-limit": Flag.String("public-link-limit").pipe(
      Flag.withSchema(PublicLinkLimit),
      Flag.withDescription("Cap the number of testers who can join via the public link (1–10000)"),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
      const session = yield* openAscSession(args);
      const created = yield* createBetaGroup(session.ctx, session.appId, {
        name: args.name.trim(),
        internal: args.internal,
        publicLinkEnabled: args["public-link"],
        publicLinkLimit: args["public-link-limit"],
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Create a TestFlight beta group (internal by default) — the group `submit ios` assigns builds to",
  ),
);
