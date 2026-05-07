import { Console, Effect } from "effect";

import { CliRuntime } from "../services/cli-runtime";
import { VersionCheck } from "../services/version-check";
import { detectInstallerFromImportMetaUrl, installCommand } from "./detect-installer";
import { isNewerVersion } from "./semver-compare";

const formatNotice = (current: string, latest: string, command: string): string =>
  [
    "",
    `╭─ Update available: @better-update/cli ${current} → ${latest}`,
    `│  Run: ${command}`,
    "╰─",
    "",
  ].join("\n");

const isOptedOut = Effect.gen(function* () {
  const runtime = yield* CliRuntime;
  const value = yield* runtime.getEnv("BETTER_UPDATE_DISABLE_UPDATE_NOTIFIER");
  return value === "1" || value === "true";
});

export const bootstrapVersionCheck = (
  currentVersion: string,
  installerHint: string,
  spawnRefresh: () => void,
): Effect.Effect<void, never, VersionCheck | CliRuntime> =>
  Effect.gen(function* () {
    if (yield* isOptedOut) {
      return;
    }
    const versionCheck = yield* VersionCheck;
    const cached = yield* versionCheck.cachedLatest;
    if (cached && isNewerVersion(cached, currentVersion)) {
      const installer = detectInstallerFromImportMetaUrl(installerHint);
      yield* Console.error(formatNotice(currentVersion, cached, installCommand(installer)));
    }
    if (yield* versionCheck.cacheStale) {
      spawnRefresh();
    }
  });

export const refreshVersionCacheIfStale: Effect.Effect<void, never, VersionCheck | CliRuntime> =
  Effect.gen(function* () {
    if (yield* isOptedOut) {
      return;
    }
    const versionCheck = yield* VersionCheck;
    const stale = yield* versionCheck.cacheStale;
    if (stale) {
      yield* versionCheck.refreshCache;
    }
  });
