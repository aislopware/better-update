import { isRecord } from "@better-update/type-guards";

import { DEFAULT_RELEASE_REPO } from "../services/service-defaults.generated";
import { isNewerVersion } from "./semver-compare";

/**
 * Where the CLI binary comes from. The CLI ships as a `bun build --compile`
 * single executable on GitHub Releases, tagged per package by lerna
 * (`@better-update/cli@<version>`); one asset per platform target. The repo is a
 * deploy-time constant (`BU_CLI_RELEASE_REPO`) so a fork that builds its own
 * binaries updates from its own releases.
 */
export const RELEASE_TAG_PREFIX = "@better-update/cli@";

export const releasesApiUrl = (repo: string = DEFAULT_RELEASE_REPO): string =>
  `https://api.github.com/repos/${repo}/releases?per_page=30`;

export const installScriptUrl = (repo: string = DEFAULT_RELEASE_REPO): string =>
  `https://raw.githubusercontent.com/${repo}/main/install.sh`;

/**
 * How this copy of the CLI was installed. The npm package is the same binary
 * inside a `@better-update/cli-<platform>` package, so an install under a
 * package manager's tree upgrades through that manager; anything else came
 * from `install.sh` (or a hand-placed download) and upgrades the same way.
 */
export type Installer = "npm" | "bun" | "pnpm" | "yarn" | "standalone";

export const detectInstaller = (binaryPath: string): Installer => {
  const normalized = binaryPath.replaceAll("\\", "/").toLowerCase();
  if (!normalized.includes("/node_modules/")) {
    return "standalone";
  }
  if (normalized.includes("/.bun/")) {
    return "bun";
  }
  if (normalized.includes("/pnpm/")) {
    return "pnpm";
  }
  if (normalized.includes("/.yarn/") || normalized.includes("/yarn/")) {
    return "yarn";
  }
  return "npm";
};

const PACKAGE_MANAGER_COMMANDS: Readonly<Record<Exclude<Installer, "standalone">, string>> = {
  bun: "bun add -g @better-update/cli@latest",
  pnpm: "pnpm add -g @better-update/cli@latest",
  yarn: "yarn global add @better-update/cli@latest",
  npm: "npm install -g @better-update/cli@latest",
};

/** The one-liner the upgrade notice / killswitch tell the user to run. */
export const installCommand = (
  installer: Installer = detectInstaller(process.execPath),
  repo: string = DEFAULT_RELEASE_REPO,
): string =>
  installer === "standalone"
    ? `curl -fsSL ${installScriptUrl(repo)} | sh`
    : PACKAGE_MANAGER_COMMANDS[installer];

/**
 * Newest published CLI version among a GitHub `/releases` listing. The listing
 * mixes every package's tags (server, web, …), so only `@better-update/cli@*`
 * counts, and drafts/prereleases are skipped. `undefined` when nothing matches
 * or the payload isn't a release array.
 */
export const pickLatestCliVersion = (releases: unknown): string | undefined => {
  if (!Array.isArray(releases)) {
    return undefined;
  }
  return releases.reduce<string | undefined>((latest, release) => {
    if (
      !isRecord(release) ||
      typeof release["tag_name"] !== "string" ||
      release["draft"] === true ||
      release["prerelease"] === true ||
      !release["tag_name"].startsWith(RELEASE_TAG_PREFIX)
    ) {
      return latest;
    }
    const version = release["tag_name"].slice(RELEASE_TAG_PREFIX.length);
    return latest === undefined || isNewerVersion(version, latest) ? version : latest;
  }, undefined);
};
