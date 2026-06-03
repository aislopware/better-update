import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../../lib/citty-effect";
import { drainPages } from "../../../lib/drain-cursor";
import { printList } from "../../../lib/output";
import { readProjectId } from "../../../lib/project-link";
import { apiClient } from "../../../services/api-client";
import { ChannelCommandError, channelErrorExtras } from "../helpers";
import { grantErrorExtras } from "./helpers";

const resolveChannel = (
  channels: readonly { readonly id: string; readonly name: string }[],
  target: string,
): Effect.Effect<{ readonly id: string; readonly name: string }, ChannelCommandError> =>
  Effect.gen(function* () {
    const channel =
      channels.find((ch) => ch.id === target) ?? channels.find((ch) => ch.name === target);
    if (!channel) {
      return yield* Effect.fail(
        new ChannelCommandError({ message: `Channel "${target}" not found by ID or name.` }),
      );
    }
    return channel;
  });

export const listCommand = defineCommand({
  meta: { name: "list", description: "List per-member grants on a channel" },
  args: {
    channel: {
      type: "positional",
      required: true,
      description: "Channel ID or channel name",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const channels = yield* drainPages((page) =>
          api.channels.list({ urlParams: { projectId, limit: 100, page } }),
        );

        const channel = yield* resolveChannel(channels, args.channel);

        const grants = yield* api.channelGrants.list({
          path: { id: channel.id },
          urlParams: {},
        });

        yield* printList(
          ["ID", "Member ID", "Effect", "Actions", "Created"],
          grants.map((grant) => [
            grant.id,
            grant.memberId,
            grant.effect,
            grant.actions.join(", "),
            grant.createdAt,
          ]),
          "No grants found for this channel.",
        );
      }),
      { exits: { ...channelErrorExtras, ...grantErrorExtras } },
    ),
});
