#!/usr/bin/env node
// Normalize the bsdiff split-package versions to the main package version.
//
// @better-update/bsdiff ships as a main package + 8 per-platform optionalDependency
// stubs (packages/bsdiff/npm/<platform>). napi-rs requires the main package's
// optionalDependencies AND every stub package.json to be version-locked to the main
// version, or the on-install resolution 404s. Lerna bumps only the main package, so
// the stubs + optionalDependencies drift.
//
// Rather than fight Lerna's lifecycle to keep the committed files in sync (which it
// doesn't stage reliably), the release pipeline treats the COMMITTED stub versions
// as placeholders and runs this script in CI right before publishing — it is the
// single source of truth that locks all versions to main before `napi prepublish`.
//
//   node scripts/sync-bsdiff-versions.mjs
//
// Idempotent: writes main.optionalDependencies[*] = main.version and every
// npm/<platform>/package.json version = main.version.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const BSDIFF_DIR = path.join(ROOT, "packages/bsdiff");
const NPM_DIR = path.join(BSDIFF_DIR, "npm");
const mainPath = path.join(BSDIFF_DIR, "package.json");

const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

const main = JSON.parse(readFileSync(mainPath, "utf8"));
const version = main.version;

for (const name of Object.keys(main.optionalDependencies ?? {})) {
  main.optionalDependencies[name] = version;
}
writeJson(mainPath, main);

const stubDirs = readdirSync(NPM_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
for (const dir of stubDirs) {
  const stubPath = path.join(NPM_DIR, dir.name, "package.json");
  const stub = JSON.parse(readFileSync(stubPath, "utf8"));
  stub.version = version;
  writeJson(stubPath, stub);
}

console.log(
  `sync-bsdiff-versions: locked ${stubDirs.length} stubs + optionalDependencies → ${version}`,
);
