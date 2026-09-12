import AppleUtils from "@expo/apple-utils";
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { ASC_AUTH_ARGS, coerceEnum, openAscContext } from "../../../application/app-store-connect";
import { inviteUser } from "../../../application/apple-users";
import { splitCommaList } from "../../../lib/asc-arg-parsers";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman } from "../../../lib/output";
import { optionalFlag } from "../../../lib/params";
import { runCommand } from "../../../lib/run-command";

const parseRoles = (raw: string) =>
  Effect.gen(function* () {
    const names = splitCommaList(raw);
    if (names.length === 0) {
      return yield* new InvalidArgumentError({ message: "--roles must list at least one role." });
    }
    return yield* Effect.all(
      names.map((name) =>
        coerceEnum<AppleUtils.UserRole>(AppleUtils.UserRole, name.toUpperCase(), "--roles"),
      ),
    );
  });

export const usersInviteCommand = Command.make(
  "invite",
  {
    ...ASC_AUTH_ARGS,
    email: Flag.String("email").pipe(Flag.withDescription("Invitee email address")),
    "first-name": Flag.String("first-name").pipe(Flag.withDescription("Invitee first name")),
    "last-name": Flag.String("last-name").pipe(Flag.withDescription("Invitee last name")),
    roles: Flag.String("roles").pipe(
      Flag.withDescription("Comma-separated roles (e.g. DEVELOPER,APP_MANAGER,ADMIN,MARKETING)"),
    ),
    "visible-apps": Flag.String("visible-apps").pipe(
      Flag.withDescription(
        "Comma-separated App ids to scope the user to (default: all apps visible)",
      ),
      optionalFlag,
    ),
    "provisioning-allowed": Flag.Boolean("provisioning-allowed").pipe(
      Flag.withDescription("Let the user manage signing assets"),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
      const roles = yield* parseRoles(args.roles);
      const provisioningAllowed = args["provisioning-allowed"];
      // An omitted OR empty/whitespace-only --visible-apps yields an empty list,
      // which inviteUser treats as "all apps visible".
      const visibleAppsRaw = args["visible-apps"];
      const visibleApps = visibleAppsRaw === undefined ? [] : splitCommaList(visibleAppsRaw);
      const session = yield* openAscContext(args);
      const result = yield* inviteUser(session.ctx, {
        email: args.email,
        firstName: args["first-name"],
        lastName: args["last-name"],
        roles,
        provisioningAllowed,
        visibleApps,
      });
      yield* printHuman(`Invited ${result.email} with roles ${result.roles.join(", ")}.`);
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription("Invite a user to the App Store Connect team (needs an Admin-role key)"),
);
