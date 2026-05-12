import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printJson, printKeyValue } from "../../lib/output";
import { OutputMode } from "../../lib/output-mode";
import { apiClient } from "../../services/api-client";

export const viewDeviceCommand = defineCommand({
  meta: { name: "view", description: "Show details for a single device" },
  args: {
    id: { type: "positional", required: true, description: "Device ID" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const device = yield* api.devices.get({ path: { id: args.id } });
        const mode = yield* OutputMode;
        if (mode.json) {
          yield* printJson(device);
          return;
        }
        yield* printKeyValue([
          ["ID", device.id],
          ["Name", device.name],
          ["Class", device.deviceClass],
          ["UDID", device.identifier],
          ["Model", device.model ?? "—"],
          ["Apple team", device.appleTeamId ?? "—"],
          ["Apple portal", device.appleDevicePortalId ?? "—"],
          ["Enabled", device.enabled ? "yes" : "no"],
          ["Created", device.createdAt],
        ]);
      }),
    ),
});
