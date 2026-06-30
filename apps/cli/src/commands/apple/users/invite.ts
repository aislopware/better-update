import AppleUtils from "@expo/apple-utils";
import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_AUTH_ARGS,
  coerceEnum,
  openAscContext,
  parseBooleanFlag,
} from "../../../application/app-store-connect";
import { inviteUser } from "../../../application/apple-users";
import { splitCommaList } from "../../../lib/asc-arg-parsers";
import { runEffect } from "../../../lib/citty-effect";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman } from "../../../lib/output";

import type { AscAuthArgs } from "../../../application/app-store-connect";

interface UsersInviteArgs extends AscAuthArgs {
  readonly email: string;
  readonly "first-name": string;
  readonly "last-name": string;
  readonly roles: string;
  readonly "visible-apps"?: string | undefined;
  readonly "provisioning-allowed"?: string | undefined;
}

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

export const usersInviteCommand = defineCommand({
  meta: {
    name: "invite",
    description: "Invite a user to the App Store Connect team (needs an Admin-role key)",
  },
  args: {
    ...ASC_AUTH_ARGS,
    email: { type: "string", required: true, description: "Invitee email address" },
    "first-name": { type: "string", required: true, description: "Invitee first name" },
    "last-name": { type: "string", required: true, description: "Invitee last name" },
    roles: {
      type: "string",
      required: true,
      description: "Comma-separated roles (e.g. DEVELOPER,APP_MANAGER,ADMIN,MARKETING)",
    },
    "visible-apps": {
      type: "string",
      description: "Comma-separated App ids to scope the user to (default: all apps visible)",
    },
    "provisioning-allowed": {
      type: "string",
      description: "Whether the user may manage signing assets: true or false",
    },
  },
  run: async ({ args }: { readonly args: UsersInviteArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const roles = yield* parseRoles(args.roles);
        const provisioningAllowed = yield* parseBooleanFlag(
          args["provisioning-allowed"],
          "--provisioning-allowed",
        );
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
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
