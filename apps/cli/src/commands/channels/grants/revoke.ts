import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../../lib/citty-effect";
import { drainPages } from "../../../lib/drain-cursor";
import { printHuman } from "../../../lib/output";
import { readProjectId } from "../../../lib/project-link";
import { promptConfirm } from "../../../lib/prompts";
import { apiClient } from "../../../services/api-client";
import { ChannelCommandError, channelErrorExtras } from "../helpers";
import { grantErrorExtras } from "./helpers";

export const revokeCommand = defineCommand({
  meta: { name: "revoke", description: "Revoke all grants for a member on a channel" },
  args: {
    channel: {
      type: "positional",
      required: true,
      description: "Channel ID or channel name",
    },
    member: {
      type: "string",
      required: true,
      description: "Member ID whose grants to revoke",
    },
    yes: { type: "boolean", description: "Skip confirmation prompt" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        if (!args.yes) {
          const confirmed = yield* promptConfirm(
            `Revoke all grants for member ${args.member} on channel ${args.channel}?`,
            { initialValue: false },
          );
          if (!confirmed) {
            yield* printHuman("Cancelled.");
            return { deleted: 0 };
          }
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

        const result = yield* api.channelGrants.delete({
          path: { id: channel.id, memberId: args.member },
        });

        yield* printHuman(`Revoked grants for member ${args.member} on channel "${channel.name}".`);
        return result;
      }),
      { exits: { ...channelErrorExtras, ...grantErrorExtras }, json: "value" },
    ),
});
