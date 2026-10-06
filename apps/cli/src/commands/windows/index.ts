import { Command } from "effect/cli";

import { desktopReleaseCommand } from "../desktop/release";

export const windowsCommand = Command.make("windows").pipe(
  Command.withDescription(
    "Release Windows installers (NSIS .exe, .msi) to electron-updater, WinSparkle and Tauri update feeds. Build and upload them with `build --platform windows` or `builds upload --platform windows`",
  ),
  Command.withSubcommands([desktopReleaseCommand("windows")]),
);
