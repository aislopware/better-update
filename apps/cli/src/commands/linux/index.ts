import { Command } from "effect/cli";

import { desktopReleaseCommand } from "../desktop/release";

export const linuxCommand = Command.make("linux").pipe(
  Command.withDescription(
    "Release Linux packages (AppImage, deb, rpm) to electron-updater and Tauri update feeds. Build and upload them with `build --platform linux` or `builds upload --platform linux`",
  ),
  Command.withSubcommands([desktopReleaseCommand("linux")]),
);
