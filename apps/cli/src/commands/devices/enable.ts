import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";

export const enableDeviceCommand = defineCommand({
  meta: { name: "enable", description: "Re-enable a device (include it in new provisioning)" },
  args: {
    id: { type: "positional", required: true, description: "Device ID" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const device = yield* api.devices.update({
          path: { id: args.id },
          payload: { enabled: true },
        });
        yield* printKeyValue([
          ["ID", device.id],
          ["Name", device.name],
          ["Enabled", "yes"],
        ]);
      }),
    ),
});
