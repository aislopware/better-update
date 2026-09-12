import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { printHumanKeyValue } from "../../lib/output";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";

export const viewDeviceCommand = Command.make(
  "view",
  {
    id: Argument.String("id").pipe(Argument.withDescription("Device ID")),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      const device = yield* api.devices.get({ params: { id: args.id } });
      yield* printHumanKeyValue([
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
      return device;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Show details for a single device"));
