import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { printKeyValue } from "../../lib/output";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";

export const enableDeviceCommand = Command.make(
  "enable",
  {
    id: Argument.String("id").pipe(Argument.withDescription("Device ID")),
  },
  Effect.fn(function* (args) {
    const api = yield* apiClient;
    const device = yield* api.devices.update({
      params: { id: args.id },
      payload: { enabled: true },
    });
    yield* printKeyValue([
      ["ID", device.id],
      ["Name", device.name],
      ["Enabled", "yes"],
    ]);
  }, runCommand()),
).pipe(Command.withDescription("Re-enable a device (include it in new provisioning)"));
