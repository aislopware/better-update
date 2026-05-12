import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printKeyValue } from "../../lib/output";
import { promptText } from "../../lib/prompts";
import { apiClient } from "../../services/api-client";

export const renameDeviceCommand = defineCommand({
  meta: { name: "rename", description: "Rename a device" },
  args: {
    id: { type: "positional", required: true, description: "Device ID" },
    name: { type: "string", description: "New name" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const name = args.name ?? (yield* promptText("New name"));
        const device = yield* api.devices.update({
          path: { id: args.id },
          payload: { name },
        });
        yield* printKeyValue([
          ["ID", device.id],
          ["Name", device.name],
        ]);
      }),
    ),
});
