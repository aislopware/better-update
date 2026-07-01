import { Console, Effect } from "effect";

import { MinVersionCheck } from "../services/min-version-check";
import { detectInstallerFromImportMetaUrl, installCommand } from "./detect-installer";
import { isNewerVersion } from "./semver-compare";

const formatBlock = (current: string, requireAbove: string, command: string): string =>
  [
    "",
    `╭─ Unsupported version: @better-update/cli ${current}`,
    `│  This server requires a version newer than ${requireAbove}. Please upgrade to continue.`,
    `│  Run: ${command}`,
    "╰─",
    "",
  ].join("\n");

/**
 * Enforce the server-published version killswitch. Resolves `true` (and prints
 * an upgrade notice to stderr) when the running version is NOT strictly newer
 * than the server's `requireCliVersionAbove` threshold — the caller then exits
 * non-zero, hard-blocking every command. Resolves `false` when the version is
 * allowed OR the threshold could not be resolved (server unreachable, no cache):
 * the gate fails OPEN so an outage never bricks an otherwise-current CLI.
 */
export const enforceMinVersion = (
  currentVersion: string,
  installerHint: string,
): Effect.Effect<boolean, never, MinVersionCheck> =>
  Effect.gen(function* () {
    const minVersionCheck = yield* MinVersionCheck;
    const requireAbove = yield* minVersionCheck.requireVersionAbove;
    if (requireAbove === undefined || isNewerVersion(currentVersion, requireAbove)) {
      return false;
    }
    const installer = detectInstallerFromImportMetaUrl(installerHint);
    yield* Console.error(formatBlock(currentVersion, requireAbove, installCommand(installer)));
    return true;
  });
