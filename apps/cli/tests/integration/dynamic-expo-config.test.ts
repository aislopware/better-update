import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { makeCliSandbox, parseEnvelope } from "./helpers/cli";

import type { CliSandbox } from "./helpers/cli";

/**
 * The compiled binary must evaluate every dynamic Expo config form, whatever
 * the project has installed. `.ts` is the one that bites: the bundled
 * `@expo/require-utils` (behind `@expo/config`) transpiles it with the
 * PROJECT's `typescript`, resolved at run time like under Expo CLI (the build
 * keeps `typescript` external), and otherwise falls back to Node's
 * `module.stripTypeScriptTypes`, which Bun lacks. A project without TypeScript,
 * or on TypeScript 7.0 (no `transpileModule`), therefore relies on
 * `lib/strip-typescript-types-shim.ts`; without it the raw source hits
 * `Module._compile`. `doctor` is the offline probe: its `project-linked` check
 * resolves the projectId through the Expo config and reports the source.
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

interface DynamicConfigCase {
  readonly label: string;
  readonly file: "app.config.js" | "app.config.ts";
  readonly projectId: string;
  readonly body: string;
}

const CONFIGS: readonly DynamicConfigCase[] = [
  {
    label: "app.config.js (CommonJS)",
    file: "app.config.js",
    projectId: "proj_from_cjs",
    body: `module.exports = ({ config }) => ({
  ...config,
  name: "CJS App",
  slug: "cjs-app",
  extra: { betterUpdate: { projectId: "proj_from_cjs" } },
});
`,
  },
  {
    label: "app.config.js (ESM syntax)",
    file: "app.config.js",
    projectId: "proj_from_esm",
    body: `export default ({ config }) => ({
  ...config,
  name: "ESM App",
  slug: "esm-app",
  extra: { betterUpdate: { projectId: "proj_from_esm" } },
});
`,
  },
  {
    // `esm-default-plugin` is tsc / Babel CommonJS output (`__esModule` + a
    // `default` function). `@expo/config` 57 handed the default import the
    // whole exports object ("is not a function"); 58 applies Babel interop.
    label: "app.config.ts default-importing a TS-compiled CommonJS plugin",
    file: "app.config.ts",
    projectId: "proj_from_esm_default_plugin",
    body: `import type { ConfigContext, ExpoConfig } from "expo/config";
import withProjectId from "esm-default-plugin";

export default ({ config }: ConfigContext): ExpoConfig =>
  withProjectId({ ...config, name: "Plugin App", slug: "plugin-app" });
`,
  },
  {
    label: "app.config.ts (typed ESM default export)",
    file: "app.config.ts",
    projectId: "proj_from_ts",
    body: `import type { ConfigContext, ExpoConfig } from "expo/config";

interface Extra {
  readonly betterUpdate: { readonly projectId: string };
}
const extra = { betterUpdate: { projectId: "proj_from_ts" } } satisfies Extra;
const identity = <T,>(value: T): T => value;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: identity("TS App"),
  slug: "ts-app",
  extra,
});
`,
  },
];

/**
 * A stand-in for a project's own `typescript` (≤ 6): its `transpileModule`
 * ignores the source and emits a config that names it, so the projectId tells
 * which compiler ran.
 */
const FAKE_PROJECT_TYPESCRIPT = `exports.ModuleKind = { CommonJS: 1, ESNext: 99, Preserve: 200 };
exports.ModuleResolutionKind = { Bundler: 100 };
exports.ScriptTarget = { ESNext: 99 };
exports.NewLineKind = { LineFeed: 1 };
exports.transpileModule = () => ({
  outputText: 'module.exports = ({ config }) => ({ ...config, name: "Project TS", slug: "project-ts", extra: { betterUpdate: { projectId: "proj_from_project_typescript" } } });\\n',
  diagnostics: [],
});
`;

const writePackage = (root: string, name: string, source: string): void => {
  const dir = path.join(root, "node_modules", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "package.json"),
    `${JSON.stringify({ name, version: "1.0.0", main: "index.js" }, null, 2)}\n`,
  );
  writeFileSync(path.join(dir, "index.js"), source);
};

const writeProjectPackageJson = (root: string, name: string): void => {
  writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify({ name, version: "1.0.0" }, null, 2)}\n`,
  );
};

describe("dynamic Expo config evaluation inside the compiled binary", () => {
  let cli: CliSandbox;
  beforeAll(() => {
    cli = makeCliSandbox();
    writeProjectPackageJson(cli.cwd, "dynamic-config-int");
    writePackage(
      cli.cwd,
      "esm-default-plugin",
      `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = (config) => ({
  ...config,
  extra: { betterUpdate: { projectId: "proj_from_esm_default_plugin" } },
});
`,
    );
  });

  afterAll(() => {
    cli.cleanup();
  });

  it.each(CONFIGS)("$label", async ({ file, projectId, body }) => {
    // One config at a time: a leftover sibling would be picked up instead.
    for (const stale of ["app.config.js", "app.config.ts"]) {
      rmSync(path.join(cli.cwd, stale), { force: true });
    }
    writeFileSync(path.join(cli.cwd, file), body);
    const result = await cli.run(["--json", "doctor"]);
    expect(result.timedOut).toBe(false);
    const check = projectLinkedCheck(result.stdout);
    expect(check.status).toBe("pass");
    expect(check.message).toBe(`projectId=${projectId} (via Expo config)`);
  });

  it("app.config.ts goes through the project's own TypeScript when it has one", async () => {
    const project = path.join(cli.cwd, "with-typescript");
    mkdirSync(project);
    writeProjectPackageJson(project, "with-typescript-int");
    writePackage(project, "typescript", FAKE_PROJECT_TYPESCRIPT);
    writeFileSync(
      path.join(project, "app.config.ts"),
      `export default ({ config }: { config: object }) => ({
  ...config,
  name: "Source App",
  slug: "source-app",
  extra: { betterUpdate: { projectId: "proj_from_shim" } },
});
`,
    );
    const result = await cli.run(["--json", "doctor"], { cwd: project });
    expect(result.timedOut).toBe(false);
    const check = projectLinkedCheck(result.stdout);
    expect(check.status).toBe("pass");
    expect(check.message).toBe("projectId=proj_from_project_typescript (via Expo config)");
  });
});
