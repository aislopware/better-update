import { installArgs, planInstall } from "./staging-install";

import type { PackageManager } from "./project-staging";

describe(installArgs, () => {
  it("uses frozen-lockfile variants matching EAS when a lockfile was found", () => {
    expect(installArgs("bun", true)).toStrictEqual(["install", "--frozen-lockfile"]);
    expect(installArgs("pnpm", true)).toStrictEqual(["install", "--frozen-lockfile"]);
    expect(installArgs("yarn", true)).toStrictEqual(["install", "--frozen-lockfile"]);
    expect(installArgs("npm", true)).toStrictEqual(["ci", "--include=dev"]);
  });

  it("passes each filter to pnpm as its own --filter selector", () => {
    expect(installArgs("pnpm", true, ["@example/mobile...", "!@example/web"])).toStrictEqual([
      "install",
      "--frozen-lockfile",
      "--filter",
      "@example/mobile...",
      "--filter",
      "!@example/web",
    ]);
    // Other package managers have no equivalent wired up: a full install.
    expect(installArgs("bun", true, ["@example/mobile..."])).toStrictEqual([
      "install",
      "--frozen-lockfile",
    ]);
  });

  it("falls back to a plain install without a lockfile", () => {
    expect(installArgs("bun", false)).toStrictEqual(["install"]);
    expect(installArgs("pnpm", false)).toStrictEqual(["install"]);
    expect(installArgs("yarn", false)).toStrictEqual(["install"]);
    expect(installArgs("npm", false)).toStrictEqual(["install", "--include=dev"]);
  });
});

const plan = (
  env: Record<string, string>,
  overrides: {
    readonly packageManager?: PackageManager;
    readonly relAppPath?: string;
    readonly appPackageName?: string | undefined;
  } = {},
) =>
  planInstall({
    env,
    packageManager: overrides.packageManager ?? "pnpm",
    relAppPath: overrides.relAppPath ?? "apps/mobile",
    appPackageName: "appPackageName" in overrides ? overrides.appPackageName : "@example/mobile",
  });

describe(planInstall, () => {
  it("installs the whole workspace by default", () => {
    expect(plan({})).toStrictEqual({ skip: false, filters: [], warnings: [] });
  });

  it("skips the install for scope none, with any package manager", () => {
    expect(plan({ BETTER_UPDATE_INSTALL_SCOPE: "none" })).toStrictEqual({ skip: true });
    expect(
      plan({ BETTER_UPDATE_INSTALL_SCOPE: "none" }, { packageManager: "npm", relAppPath: "" }),
    ).toStrictEqual({ skip: true });
  });

  it("filters to the app's workspace closure for scope app", () => {
    expect(plan({ BETTER_UPDATE_INSTALL_SCOPE: "app" })).toStrictEqual({
      skip: false,
      filters: ["@example/mobile..."],
      warnings: [],
    });
  });

  it("ignores scope app when the app is the workspace root", () => {
    expect(plan({ BETTER_UPDATE_INSTALL_SCOPE: "app" }, { relAppPath: "" })).toStrictEqual({
      skip: false,
      filters: [],
      warnings: [],
    });
  });

  it("passes BETTER_UPDATE_INSTALL_FILTER through, after the app filter", () => {
    expect(
      plan({ BETTER_UPDATE_INSTALL_FILTER: "  !@example/mobile  " }, { relAppPath: "" }),
    ).toStrictEqual({ skip: false, filters: ["!@example/mobile"], warnings: [] });
    expect(
      plan({
        BETTER_UPDATE_INSTALL_SCOPE: "app",
        BETTER_UPDATE_INSTALL_FILTER: "!@example/docs @example/ui",
      }),
    ).toStrictEqual({
      skip: false,
      filters: ["@example/mobile...", "!@example/docs", "@example/ui"],
      warnings: [],
    });
  });

  it("drops filters with a warning outside pnpm", () => {
    const result = plan(
      { BETTER_UPDATE_INSTALL_FILTER: "!@example/mobile" },
      { packageManager: "bun" },
    );
    expect(result).toMatchObject({ skip: false, filters: [] });
    expect(!result.skip && result.warnings).toHaveLength(1);
  });

  it("warns on an unknown scope and on an app without a package name", () => {
    expect(plan({ BETTER_UPDATE_INSTALL_SCOPE: "workspace" })).toMatchObject({
      skip: false,
      filters: [],
      warnings: [expect.stringContaining('not "app" or "none"')],
    });
    expect(
      plan({ BETTER_UPDATE_INSTALL_SCOPE: "app" }, { appPackageName: undefined }),
    ).toMatchObject({
      skip: false,
      filters: [],
      warnings: [expect.stringContaining('needs a "name"')],
    });
  });
});
