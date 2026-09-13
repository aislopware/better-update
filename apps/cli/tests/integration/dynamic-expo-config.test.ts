import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { makeCliSandbox, parseEnvelope } from "./helpers/cli";

import type { CliSandbox } from "./helpers/cli";

/**
 * The compiled binary must evaluate every dynamic Expo config form on its own:
 * it bundles `@expo/config`, so nothing from the user's `node_modules` (their
 * `typescript`, their Node) takes part. `.ts` is the one that bites — Bun has
 * no `module.stripTypeScriptTypes` and the bundled TypeScript 7 shim cannot
 * transpile, so without the shim in `lib/expo-config.ts` the raw source hits
 * `Module._compile`. `doctor` is the offline probe: its `project-linked`
 * check resolves the projectId through the Expo config and reports the source.
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

describe("dynamic Expo config evaluation inside the compiled binary", () => {
  let cli: CliSandbox;
  beforeAll(() => {
    cli = makeCliSandbox();
    writeFileSync(
      path.join(cli.cwd, "package.json"),
      `${JSON.stringify({ name: "dynamic-config-int", version: "1.0.0" }, null, 2)}\n`,
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
});
