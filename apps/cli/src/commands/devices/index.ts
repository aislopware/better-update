import { Command } from "effect/unstable/cli";

import { addDeviceCommand } from "./add";
import { deleteDeviceCommand } from "./delete";
import { disableDeviceCommand } from "./disable";
import { enableDeviceCommand } from "./enable";
import { listDevicesCommand } from "./list";
import { renameDeviceCommand } from "./rename";
import { syncDeviceCommand } from "./sync";
import { viewDeviceCommand } from "./view";

export const devicesCommand = Command.make("devices").pipe(
  Command.withDescription("Manage Apple devices for ad-hoc distribution"),
  Command.withSubcommands([
    addDeviceCommand,
    listDevicesCommand,
    viewDeviceCommand,
    syncDeviceCommand,
    renameDeviceCommand,
    enableDeviceCommand,
    disableDeviceCommand,
    deleteDeviceCommand,
  ]),
);
