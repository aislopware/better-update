import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printHuman } from "../../lib/output";
import { promptConfirm } from "../../lib/prompts";
import { apiClient } from "../../services/api-client";

export const deleteDeviceCommand = defineCommand({
  meta: { name: "delete", description: "Delete a device permanently" },
  args: {
    id: { type: "positional", required: true, description: "Device ID" },
    yes: { type: "boolean", description: "Skip the confirmation prompt" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        if (!args.yes) {
          const confirmed = yield* promptConfirm(`Delete device ${args.id}?`, {
            initialValue: false,
          });
          if (!confirmed) {
            yield* printHuman("Cancelled.");
            return;
          }
        }
        const api = yield* apiClient;
        yield* api.devices.delete({ path: { id: args.id } });
        yield* printHuman(`Deleted device ${args.id}.`);
      }),
    ),
});
