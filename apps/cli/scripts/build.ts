/**
 * Compiles the CLI into a standalone executable with `bun build --compile`.
 *
 *   bun scripts/build.ts                 # host platform → dist/better-update
 *   bun scripts/build.ts --target linux-x64-musl
 *                                        # one target → dist/better-update-<target>
 *   bun scripts/build.ts --all           # every target → dist/better-update-<target>
 *
 * The binary embeds the bundle, every static `.node` addon it references
 * (`@better-update/bsdiff` — the file for the target must exist in
 * packages/bsdiff, which is what CI's native build jobs produce) and the Bun
 * runtime, so end users need neither Node nor Bun installed.
 */
import fs from "node:fs";
import path from "node:path";

import type { BunPlugin } from "bun";

const CLI_DIR = path.resolve(import.meta.dirname, "..");
const ENTRY = path.join(CLI_DIR, "src/index.ts");
const OUT_DIR = path.join(CLI_DIR, "dist");
const BINARY = "better-update";

/** Release targets. Keep in sync with `install.sh`, `.gitlab-ci.yml` and bsdiff's napi targets. */
const TARGETS = {
  "darwin-arm64": "bun-darwin-arm64",
  "linux-x64": "bun-linux-x64",
  "linux-arm64": "bun-linux-arm64",
  "linux-x64-musl": "bun-linux-x64-musl",
  "linux-arm64-musl": "bun-linux-arm64-musl",
} as const satisfies Record<string, Bun.Build.CompileTarget>;

type TargetName = keyof typeof TARGETS;

const ALL_TARGETS: readonly TargetName[] = [
  "darwin-arm64",
  "linux-x64",
  "linux-arm64",
  "linux-x64-musl",
  "linux-arm64-musl",
];

const isTargetName = (value: string): value is TargetName => value in TARGETS;

const log = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const fail = (message: string): void => {
  process.stderr.write(`build: ${message}\n`);
  process.exitCode = 1;
};

/**
 * `simple-plist` (via `xcode`) ships tsc's UMD wrapper, whose factory takes
 * `require` as a PARAMETER: the bundler cannot see through the shadowing, so
 * `require("bplist-creator")` stays a runtime lookup and fails inside the
 * binary, where nothing is on disk. Renaming the parameter makes those calls
 * hit the real module-scope `require`, which the bundler resolves and embeds.
 */
const UMD_FACTORY = "})(function (require, exports) {";
const unwrapUmd: BunPlugin = {
  name: "unwrap-tsc-umd",
  setup(build) {
    build.onLoad({ filter: /node_modules[\\/]simple-plist[\\/].*\.js$/u }, async (args) => {
      const source = await Bun.file(args.path).text();
      return {
        contents: source.replace(UMD_FACTORY, "})(function (__umdRequire, exports) {"),
        loader: "js",
      };
    });
  },
};

const compile = async (target: TargetName, outfile: string): Promise<boolean> => {
  const result = await Bun.build({
    entrypoints: [ENTRY],
    target: "bun",
    format: "esm",
    sourcemap: "inline",
    plugins: [unwrapUmd],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    compile: {
      target: TARGETS[target],
      outfile,
      // A CLI must not pick up the user's project `.env` / `bunfig.toml` from
      // the working directory: Node never did, and it would silently redirect
      // BETTER_UPDATE_URL & co.
      autoloadDotenv: false,
      autoloadBunfig: false,
    },
  });
  if (!result.success) {
    for (const entry of result.logs) {
      process.stderr.write(`${entry.message}\n`);
    }
    fail(`compile failed for ${target}`);
    return false;
  }
  // `compile` embeds the source map in the executable (stack traces already
  // resolve to src/), but Bun still writes a sibling `.map`; it would only
  // bloat the release.
  fs.rmSync(`${outfile}.map`, { force: true });
  const { size } = fs.statSync(outfile);
  log(
    `built ${path.relative(CLI_DIR, outfile)} (${target}, ${(size / 1024 / 1024).toFixed(1)} MB)`,
  );
  return true;
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const targetIndex = args.indexOf("--target");
  const explicit = targetIndex === -1 ? undefined : args[targetIndex + 1];
  if (explicit !== undefined && !isTargetName(explicit)) {
    fail(`unknown target ${explicit}; expected one of ${ALL_TARGETS.join(", ")}`);
    return;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (args.includes("--all")) {
    for (const target of ALL_TARGETS) {
      if (!(await compile(target, path.join(OUT_DIR, `${BINARY}-${target}`)))) {
        return;
      }
    }
    return;
  }
  if (explicit !== undefined) {
    await compile(explicit, path.join(OUT_DIR, `${BINARY}-${explicit}`));
    return;
  }
  const host = `${process.platform}-${process.arch}`;
  if (!isTargetName(host)) {
    fail(`no release target for host ${host}; pass --target <${ALL_TARGETS.join("|")}>`);
    return;
  }
  await compile(host, path.join(OUT_DIR, BINARY));
};

// eslint-disable-next-line node/no-top-level-await -- bun script entry, never require()d
await main();
