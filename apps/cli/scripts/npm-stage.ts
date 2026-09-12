/**
 * Stages the npm distribution of the CLI from the compiled binaries:
 *
 *   dist/npm/cli-<target>/     one package per platform, `os`/`cpu`/`libc`
 *                              gated, holding just the binary
 *   dist/npm/cli/              @better-update/cli — the sh launcher (npm/bin) +
 *                              optionalDependencies pinned to the platform
 *                              packages at the same version
 *
 *   bun scripts/npm-stage.ts            # every target; dist/better-update-<target> must exist
 *   bun scripts/npm-stage.ts --local    # host target only, optionalDependencies as
 *                                       # `file:` links — for `npm install` smoke tests
 *
 * Publishing is CI's job (`publish-cli` in .gitlab-ci.yml): platform packages
 * first, then the main package, all with `npm publish --access public`.
 */
import fs from "node:fs";
import path from "node:path";

const CLI_DIR = path.resolve(import.meta.dirname, "..");
const DIST = path.join(CLI_DIR, "dist");
const OUT = path.join(DIST, "npm");
const SCOPE = "@better-update";

interface Target {
  readonly name: string;
  readonly os: string;
  readonly cpu: string;
  readonly libc?: string;
}

/** Keep in sync with scripts/build.ts TARGETS. */
const TARGETS: readonly Target[] = [
  { name: "darwin-arm64", os: "darwin", cpu: "arm64" },
  { name: "linux-x64", os: "linux", cpu: "x64", libc: "glibc" },
  { name: "linux-arm64", os: "linux", cpu: "arm64", libc: "glibc" },
  { name: "linux-x64-musl", os: "linux", cpu: "x64", libc: "musl" },
  { name: "linux-arm64-musl", os: "linux", cpu: "arm64", libc: "musl" },
];

interface PackageJson {
  readonly version: string;
  readonly license: string;
  readonly homepage: string;
  readonly repository: unknown;
}

const isPackageJson = (value: unknown): value is PackageJson =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { version?: unknown }).version === "string" &&
  typeof (value as { license?: unknown }).license === "string" &&
  typeof (value as { homepage?: unknown }).homepage === "string";

const readPackage = (): PackageJson | undefined => {
  const parsed: unknown = JSON.parse(fs.readFileSync(path.join(CLI_DIR, "package.json"), "utf8"));
  return isPackageJson(parsed) ? parsed : undefined;
};

const writeJson = (file: string, value: unknown): void => {
  fs.writeFileSync(file, `${JSON.stringify(value, undefined, 2)}\n`);
};

const stagePlatform = (pkg: PackageJson, target: Target, local: boolean): string => {
  const binary = path.join(DIST, local ? "better-update" : `better-update-${target.name}`);
  if (!fs.existsSync(binary)) {
    process.stderr.write(`npm-stage: missing ${path.relative(CLI_DIR, binary)}; build it first\n`);
    process.exitCode = 1;
    return "";
  }
  const dir = path.join(OUT, `cli-${target.name}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(binary, path.join(dir, "better-update"));
  fs.chmodSync(path.join(dir, "better-update"), 0o755);
  writeJson(path.join(dir, "package.json"), {
    name: `${SCOPE}/cli-${target.name}`,
    version: pkg.version,
    description: `better-update CLI binary for ${target.name}`,
    license: pkg.license,
    homepage: pkg.homepage,
    repository: pkg.repository,
    os: [target.os],
    cpu: [target.cpu],
    ...(target.libc === undefined ? {} : { libc: [target.libc] }),
    files: ["better-update"],
    publishConfig: { access: "public" },
  });
  return dir;
};

const stageMain = (pkg: PackageJson, targets: readonly Target[], local: boolean): void => {
  const dir = path.join(OUT, "cli");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
  for (const file of ["README.md", "bin/better-update"]) {
    fs.copyFileSync(path.join(CLI_DIR, "npm", file), path.join(dir, file));
  }
  fs.chmodSync(path.join(dir, "bin", "better-update"), 0o755);
  writeJson(path.join(dir, "package.json"), {
    name: `${SCOPE}/cli`,
    version: pkg.version,
    description:
      "better-update CLI — OTA updates, native builds, credential vault, env vars. Installs a standalone binary.",
    license: pkg.license,
    homepage: pkg.homepage,
    repository: pkg.repository,
    bin: { "better-update": "bin/better-update" },
    files: ["bin"],
    optionalDependencies: Object.fromEntries(
      targets.map((target) => [
        `${SCOPE}/cli-${target.name}`,
        local ? `file:${path.join(OUT, `cli-${target.name}`)}` : pkg.version,
      ]),
    ),
    publishConfig: { access: "public" },
  });
};

const main = (): void => {
  const local = process.argv.includes("--local");
  const pkg = readPackage();
  if (pkg === undefined) {
    process.stderr.write("npm-stage: apps/cli/package.json is missing version/license/homepage\n");
    process.exitCode = 1;
    return;
  }
  const host = `${process.platform}-${process.arch}`;
  const targets = local ? TARGETS.filter((target) => target.name === host) : TARGETS;
  if (targets.length === 0) {
    process.stderr.write(`npm-stage: no target for host ${host}\n`);
    process.exitCode = 1;
    return;
  }
  const staged = targets.map((target) => stagePlatform(pkg, target, local)).filter(Boolean);
  if (staged.length !== targets.length) {
    return;
  }
  stageMain(pkg, targets, local);
  process.stdout.write(
    `staged ${SCOPE}/cli@${pkg.version} + ${targets.map((target) => `cli-${target.name}`).join(", ")} in ${path.relative(CLI_DIR, OUT)}\n`,
  );
};

main();
