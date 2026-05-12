import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";

export const disableDeviceCommand = defineCommand({
  meta: {
    name: "disable",
    description: "Disable a device (exclude it from new provisioning profiles)",
  },
  args: {
    id: { type: "positional", required: true, description: "Device ID" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const device = yield* api.devices.update({
          path: { id: args.id },
          payload: { enabled: false },
        });
        yield* printKeyValue([
          ["ID", device.id],
          ["Name", device.name],
          ["Enabled", "no"],
        ]);
      }),
    ),
});
