import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { printHuman } from "../../lib/output";
import { yesFlag } from "../../lib/params";
import { promptConfirm } from "../../lib/prompts";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";

export const deleteDeviceCommand = Command.make(
  "delete",
  {
    id: Argument.String("id").pipe(Argument.withDescription("Device ID")),
    yes: yesFlag(),
  },
  Effect.fn(function* (args) {
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
    yield* api.devices.delete({ params: { id: args.id } });
    yield* printHuman(`Deleted device ${args.id}.`);
  }, runCommand()),
).pipe(Command.withDescription("Delete a device permanently"));
