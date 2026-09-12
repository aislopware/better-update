import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { printKeyValue } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { promptText } from "../../lib/prompts";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";

export const renameDeviceCommand = Command.make(
  "rename",
  {
    id: Argument.String("id").pipe(Argument.withDescription("Device ID")),
    name: Flag.String("name").pipe(Flag.withDescription("New name"), optionalFlag),
  },
  Effect.fn(function* (args) {
    const api = yield* apiClient;
    const name = args.name ?? (yield* promptText("New name"));
    const device = yield* api.devices.update({
      params: { id: args.id },
      payload: { name },
    });
    yield* printKeyValue([
      ["ID", device.id],
      ["Name", device.name],
    ]);
  }, runCommand()),
).pipe(Command.withDescription("Rename a device"));
