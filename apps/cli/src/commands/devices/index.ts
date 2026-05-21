import { defineCommand } from "citty";

import { addDeviceCommand } from "./add";
import { deleteDeviceCommand } from "./delete";
import { disableDeviceCommand } from "./disable";
import { enableDeviceCommand } from "./enable";
import { listDevicesCommand } from "./list";
import { renameDeviceCommand } from "./rename";
import { viewDeviceCommand } from "./view";

export const devicesCommand = defineCommand({
  meta: { name: "devices", description: "Manage Apple devices for ad-hoc distribution" },
  subCommands: {
    add: addDeviceCommand,
    list: listDevicesCommand,
    view: viewDeviceCommand,
    rename: renameDeviceCommand,
    enable: enableDeviceCommand,
    disable: disableDeviceCommand,
    delete: deleteDeviceCommand,
  },
});
