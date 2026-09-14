import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { makeCliSandbox, parseEnvelope } from "./helpers/cli";

import type { CliSandbox } from "./helpers/cli";

/**
 * Config plugins listed in app.json live in the USER's node_modules and are
 * evaluated on disk by the bundled `@expo/config`. Since Bun 1.3.4 a standalone
 * executable ignores every package.json at runtime unless built with
 * `autoloadPackageJson` (oven-sh/bun#42368): a plugin's bare
 * `require("some-dep")` then skips `main` / `exports` and dies with "Cannot
 * find module" — which `readProjectId` used to swallow as "Project not
 * linked" (the 0.79.x report from a bare RN app with `expo-image` plugins).
 * `doctor` is the offline probe: its `project-linked` check reports the
 * resolved id, or the real load error.
 */

interface DoctorCheck {
  readonly id: string;
  readonly status: "pass" | "warn" | "fail";
  readonly message: string;
}

const projectLinkedCheck = (stdout: string): DoctorCheck => {
  const envelope = parseEnvelope(stdout);
  expect(envelope.ok).toBe(true);
  const { checks } = (envelope as { readonly data: { readonly checks: readonly DoctorCheck[] } })
    .data;
  const check = checks.find((entry) => entry.id === "project-linked");
  if (!check) {
    throw new Error(`doctor reported no project-linked check:\n${stdout}`);
  }
  return check;
};

const writeJson = (file: string, value: unknown): void => {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

/**
 * `<root>/node_modules/<name>` with a non-`index.js` entry so only a resolver
 * that reads package.json (`main` / `exports`) can find it.
 */
const writePackage = (
  root: string,
  name: string,
  entry: string,
  source: string,
  pkg: Record<string, unknown> = {},
): void => {
  const dir = path.join(root, "node_modules", name);
  mkdirSync(path.dirname(path.join(dir, entry)), { recursive: true });
  writeJson(path.join(dir, "package.json"), { name, version: "1.0.0", main: entry, ...pkg });
  writeFileSync(path.join(dir, entry), source);
};

describe("app.json config plugins resolved from the user's node_modules", () => {
  let cli: CliSandbox;
  beforeAll(() => {
    cli = makeCliSandbox();
    writeJson(path.join(cli.cwd, "package.json"), { name: "plugins-int", version: "1.0.0" });
    // The plugin's dependency: reachable only through `exports` (no index.js).
    writePackage(
      cli.cwd,
      "plugin-dep",
      "lib/main.js",
      'module.exports = { projectId: "proj_from_plugin" };\n',
      { exports: { ".": "./lib/main.js" } },
    );
    // The plugin itself, the `app.plugin.js` form Expo packages ship.
    const pluginDir = path.join(cli.cwd, "node_modules", "fake-plugin");
    mkdirSync(pluginDir, { recursive: true });
    writeJson(path.join(pluginDir, "package.json"), { name: "fake-plugin", version: "1.0.0" });
    writeFileSync(
      path.join(pluginDir, "app.plugin.js"),
      `const dep = require("plugin-dep");
module.exports = (config) => ({
  ...config,
  extra: { ...config.extra, betterUpdate: { projectId: dep.projectId } },
});
`,
    );
    // A plugin whose dependency is missing: the load error must reach the user.
    const brokenDir = path.join(cli.cwd, "node_modules", "broken-plugin");
    mkdirSync(brokenDir, { recursive: true });
    writeJson(path.join(brokenDir, "package.json"), { name: "broken-plugin", version: "1.0.0" });
    writeFileSync(
      path.join(brokenDir, "app.plugin.js"),
      'require("dep-that-is-not-installed");\nmodule.exports = (config) => config;\n',
    );
  });

  afterAll(() => {
    cli.cleanup();
  });

  it("evaluates a plugin whose bare require() needs package.json main/exports", async () => {
    // Bare-RN shape: no `expo` wrapper, no projectId of its own — the plugin sets it.
    writeJson(path.join(cli.cwd, "app.json"), {
      name: "Plugin App",
      slug: "plugin-app",
      plugins: ["fake-plugin"],
    });
    const result = await cli.run(["--json", "doctor"]);
    expect(result.timedOut).toBe(false);
    const check = projectLinkedCheck(result.stdout);
    expect(check.message).toBe("projectId=proj_from_plugin (via Expo config)");
    expect(check.status).toBe("pass");
  });

  it("reports the plugin load error instead of the generic 'not linked' hint", async () => {
    writeJson(path.join(cli.cwd, "app.json"), {
      name: "Plugin App",
      slug: "plugin-app",
      extra: { betterUpdate: { projectId: "proj_masked" } },
      plugins: ["broken-plugin"],
    });
    const result = await cli.run(["--json", "doctor"]);
    expect(result.timedOut).toBe(false);
    const check = projectLinkedCheck(result.stdout);
    expect(check.status).toBe("warn");
    expect(check.message).toContain("Failed to load Expo config");
    expect(check.message).toContain("dep-that-is-not-installed");
    expect(check.message).not.toContain("BETTER_UPDATE_PROJECT_ID");
  });
});
