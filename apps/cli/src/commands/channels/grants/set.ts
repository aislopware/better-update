import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../../lib/citty-effect";
import { drainPages } from "../../../lib/drain-cursor";
import { printHumanKeyValue } from "../../../lib/output";
import { readProjectId } from "../../../lib/project-link";
import { apiClient } from "../../../services/api-client";
import { ChannelCommandError, channelErrorExtras } from "../helpers";
import { GrantCommandError, grantErrorExtras } from "./helpers";

export const setCommand = defineCommand({
  meta: { name: "set", description: "Create or replace a member's grant on a channel" },
  args: {
    channel: {
      type: "positional",
      required: true,
      description: "Channel ID or channel name",
    },
    member: {
      type: "string",
      required: true,
      description: "Member ID to grant permissions to",
    },
    actions: {
      type: "string",
      required: true,
      description:
        "Permission action tokens in resource:action format, comma-separated (e.g. update:create,rollout:update)",
    },
    effect: {
      type: "string",
      description: "Grant effect: allow (default) or deny",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const effectValue = args.effect ?? "allow";
        if (effectValue !== "allow" && effectValue !== "deny") {
          return yield* new GrantCommandError({
            message: `Invalid effect "${effectValue}" — must be "allow" or "deny".`,
          });
        }

        const actionTokens = args.actions
          .split(",")
          .map((tok) => tok.trim())
          .filter((tok) => tok.length > 0);

        if (actionTokens.length === 0) {
          return yield* new GrantCommandError({
            message: "At least one action token is required.",
          });
        }

        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const channels = yield* drainPages((page) =>
          api.channels.list({ urlParams: { projectId, limit: 100, page } }),
        );

        const channel =
          channels.find((ch) => ch.id === args.channel) ??
          channels.find((ch) => ch.name === args.channel);

        if (!channel) {
          return yield* new ChannelCommandError({
            message: `Channel "${args.channel}" not found by ID or name.`,
          });
        }

        const grant = yield* api.channelGrants.upsert({
          path: { id: channel.id, memberId: args.member },
          payload: { effect: effectValue, actions: actionTokens },
        });

        yield* printHumanKeyValue([
          ["ID", grant.id],
          ["Member ID", grant.memberId],
          ["Channel ID", grant.scopeId],
          ["Effect", grant.effect],
          ["Actions", grant.actions.join(", ")],
          ["Created", grant.createdAt],
        ]);
        return grant;
      }),
      { exits: { ...channelErrorExtras, ...grantErrorExtras } },
    ),
});
