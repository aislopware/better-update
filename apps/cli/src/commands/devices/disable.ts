import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { printKeyValue } from "../../lib/output";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";

export const disableDeviceCommand = Command.make(
  "disable",
  {
    id: Argument.String("id").pipe(Argument.withDescription("Device ID")),
  },
  Effect.fn(function* (args) {
    const api = yield* apiClient;
    const device = yield* api.devices.update({
      params: { id: args.id },
      payload: { enabled: false },
    });
    yield* printKeyValue([
      ["ID", device.id],
      ["Name", device.name],
      ["Enabled", "no"],
    ]);
  }, runCommand()),
).pipe(Command.withDescription("Disable a device (exclude it from new provisioning profiles)"));
