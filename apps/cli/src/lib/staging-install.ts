import path from "node:path";

import { isRecord } from "@better-update/type-guards";
import { FileSystem, Effect } from "effect";

import { runStep } from "../commands/build/run-step";
import { printHuman } from "./output";
import { printWarn } from "./warning-style";

import type { BuildFailedError } from "./exit-codes";
import type { OutputMode } from "./output-mode";
import type { PackageManager } from "./project-staging";

/** `app` installs the app's pnpm workspace closure; `none` skips the install. */
export const INSTALL_SCOPE_ENV = "BETTER_UPDATE_INSTALL_SCOPE";
/** Space-separated pnpm `--filter` selectors, e.g. `"!@example/mobile"`. */
export const INSTALL_FILTER_ENV = "BETTER_UPDATE_INSTALL_FILTER";

/**
 * Install args per package manager, frozen-lockfile variants matching EAS
 * (`bun install --frozen-lockfile` / `npm ci --include=dev` / etc.) so the
 * staged install resolves exactly what the user's lockfile pins. `filters`
 * become pnpm `--filter` selectors; other package managers ignore them.
 */
export const installArgs = (
  packageManager: PackageManager,
  frozen: boolean,
  filters: readonly string[] = [],
): readonly string[] => {
  if (packageManager === "npm") {
    return frozen ? ["ci", "--include=dev"] : ["install", "--include=dev"];
  }
  const install = frozen ? ["install", "--frozen-lockfile"] : ["install"];
  return packageManager === "pnpm"
    ? [...install, ...filters.flatMap((filter) => ["--filter", filter])]
    : install;
};

export type InstallPlan =
  | { readonly skip: true }
  | {
      readonly skip: false;
      /** pnpm `--filter` selectors; empty installs the whole workspace. */
      readonly filters: readonly string[];
      readonly warnings: readonly string[];
    };

/**
 * What the staged install should do, from the build environment:
 *
 * - `BETTER_UPDATE_INSTALL_SCOPE=none` skips it, for a custom build command
 *   that installs its own dependencies (e.g. inside a container). Any package
 *   manager.
 * - `BETTER_UPDATE_INSTALL_SCOPE=app`: in a pnpm monorepo, install only the
 *   app's workspace closure (`--filter <app>...`). A no-op when the app is the
 *   workspace root.
 * - `BETTER_UPDATE_INSTALL_FILTER`: space-separated pnpm `--filter` selectors,
 *   passed through as written and combined with the `app` filter.
 *
 * Filters are opt-in because a root `postinstall` or a root-only devDependency
 * the build relies on may then be skipped. Without pnpm the whole workspace is
 * installed, with a warning.
 */
export const planInstall = (params: {
  readonly env: Readonly<Record<string, string>>;
  readonly packageManager: PackageManager;
  readonly relAppPath: string;
  /** The app's `package.json` name; read only when the `app` scope needs it. */
  readonly appPackageName: string | undefined;
}): InstallPlan => {
  const scope = params.env[INSTALL_SCOPE_ENV];
  if (scope === "none") {
    return { skip: true };
  }
  const scopeWarnings =
    scope === undefined || scope === "" || scope === "app"
      ? []
      : [`${INSTALL_SCOPE_ENV}=${scope} is not "app" or "none"; ignoring it.`];
  const wantsApp = scope === "app" && params.relAppPath !== "";
  const appMissingName = wantsApp && params.appPackageName === undefined;
  const appFilters =
    wantsApp && params.appPackageName !== undefined ? [`${params.appPackageName}...`] : [];
  const userFilters =
    params.env[INSTALL_FILTER_ENV]?.split(/\s+/u).filter((filter) => filter !== "") ?? [];
  const filters = [...appFilters, ...userFilters];
  const nameWarnings = appMissingName
    ? [
        `${INSTALL_SCOPE_ENV}=app needs a "name" in ${params.relAppPath}/package.json; not filtering by app.`,
      ]
    : [];
  if (filters.length > 0 && params.packageManager !== "pnpm") {
    return {
      skip: false,
      filters: [],
      warnings: [
        ...scopeWarnings,
        `${INSTALL_SCOPE_ENV}=app and ${INSTALL_FILTER_ENV} only apply to pnpm workspaces; installing the whole ${params.packageManager} workspace.`,
      ],
    };
  }
  return { skip: false, filters, warnings: [...scopeWarnings, ...nameWarnings] };
};

const readPackageName = (projectRoot: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const manifest = yield* fs
      .readFileString(path.join(projectRoot, "package.json"))
      .pipe(Effect.orElseSucceed(() => "{}"));
    const parsed: unknown = yield* Effect.try(() => JSON.parse(manifest) as unknown).pipe(
      Effect.orElseSucceed(() => undefined),
    );
    const name = isRecord(parsed) ? parsed["name"] : undefined;
    return typeof name === "string" && name !== "" ? name : undefined;
  });

/** Run the staged `<pm> install` as {@link planInstall} decides. */
export const runStagedInstall = (params: {
  readonly stagingRoot: string;
  readonly projectRoot: string;
  readonly relAppPath: string;
  readonly packageManager: PackageManager;
  readonly frozen: boolean;
  readonly env: Readonly<Record<string, string>>;
}): Effect.Effect<void, BuildFailedError, FileSystem.FileSystem | OutputMode> =>
  Effect.gen(function* () {
    const appPackageName =
      params.env[INSTALL_SCOPE_ENV] === "app" && params.relAppPath !== ""
        ? yield* readPackageName(params.projectRoot)
        : undefined;
    const plan = planInstall({ ...params, appPackageName });
    if (plan.skip) {
      yield* printHuman(`${INSTALL_SCOPE_ENV}=none — skipping the staged dependency install.`);
      return;
    }
    yield* Effect.forEach(plan.warnings, printWarn, { discard: true });
    yield* runStep(
      {
        command: params.packageManager,
        args: [...installArgs(params.packageManager, params.frozen, plan.filters)],
        cwd: params.stagingRoot,
        env: params.env,
      },
      `${params.packageManager} install`,
    );
  });
