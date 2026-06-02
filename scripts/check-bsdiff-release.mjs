#!/usr/bin/env node
// Release-invariant guard for the @better-update/bsdiff napi-rs package.
//
// bsdiff is a native addon published as a main package + 8 per-platform
// optionalDependency stubs. The CLI depends on it at runtime, so a malformed
// bsdiff publish 404s `npm install @better-update/cli` for everyone. This
// script encodes the invariants that, when violated, broke the publish before
// (see memory project_bsdiff_publish_mechanics):
//
//   1. main package is NOT private          (private:true -> Lerna skips it)
//   2. main has publishConfig.access:public  (scoped pkgs default to restricted -> E402)
//   3. main has NO `prepublishOnly` script   (napi prepublish there -> GH-release 401
//                                              aborts the Lerna main-package publish)
//   4. all 8 stub versions === main version  (Lerna bumps main but not the nested
//      and main.optionalDependencies too      stubs -> silent version drift)
//   5. every stub also has publishConfig.access:public  (napi prepublish needs it)
//   6. stub set === optionalDependencies set === napi.targets count  (no missing/extra)
//
// Offline by default (static checks). With --check-npm it also asserts every
// stub@<version> already resolves on npm — the ordering guard run in Publish CLI
// before `lerna publish`, so the main package never ships before its binaries.
//
// Usage:
//   node scripts/check-bsdiff-release.mjs              # static invariants (CI on every PR)
//   node scripts/check-bsdiff-release.mjs --check-npm  # + stubs must exist on npm (pre-publish gate)

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const BSDIFF_DIR = path.join(ROOT, "packages/bsdiff");
const NPM_DIR = path.join(BSDIFF_DIR, "npm");

const checkNpm = process.argv.includes("--check-npm");
const failures = [];
const fail = (msg) => failures.push(msg);
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

const main = readJson(path.join(BSDIFF_DIR, "package.json"));
const version = main.version;

// 1. not private
if (main.private) {
  fail("packages/bsdiff/package.json has `private: true` — Lerna will skip publishing it.");
}

// 2. main publishConfig.access:public
if (main.publishConfig?.access !== "public") {
  fail(
    'main package is missing `publishConfig: { "access": "public" }` (scoped pkgs publish restricted -> E402).',
  );
}

// 3. no prepublishOnly footgun
if (main.scripts?.prepublishOnly) {
  fail(
    "main package has a `prepublishOnly` script — it fires during Lerna publish and aborts it " +
      "(use a non-lifecycle name like `napi:prepublish` instead).",
  );
}

// Stub packages live in packages/bsdiff/npm/<platform>/package.json (NOT workspace members).
const stubDirs = readdirSync(NPM_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => path.join(NPM_DIR, d.name, "package.json"));

const stubs = stubDirs.map((file) => ({ file, pkg: readJson(file) }));
const stubNames = stubs.map(({ pkg }) => pkg.name);

// 6. counts line up: stubs === optionalDependencies === napi.targets
const optDeps = main.optionalDependencies ?? {};
const optDepNames = Object.keys(optDeps);
const targetCount = main.napi?.targets?.length ?? 0;
if (stubs.length !== targetCount) {
  fail(`stub count (${stubs.length}) != napi.targets count (${targetCount}).`);
}
const missingFromOpt = stubNames.filter((n) => !(n in optDeps));
const extraInOpt = optDepNames.filter((n) => !stubNames.includes(n));
if (missingFromOpt.length) {
  fail(`stubs not listed in optionalDependencies: ${missingFromOpt.join(", ")}`);
}
if (extraInOpt.length) {
  fail(`optionalDependencies reference non-existent stubs: ${extraInOpt.join(", ")}`);
}

// 4. optionalDependencies versions === main version
for (const [name, range] of Object.entries(optDeps)) {
  if (range !== version) {
    fail(`optionalDependencies["${name}"] is "${range}", expected "${version}" (= main version).`);
  }
}

// 4 + 5. each stub: version matches main, publishConfig.access:public
for (const { file, pkg } of stubs) {
  const rel = path.relative(ROOT, file);
  if (pkg.version !== version) {
    fail(`${rel}: version "${pkg.version}" != main "${version}" — run \`napi version\` to resync.`);
  }
  if (pkg.publishConfig?.access !== "public") {
    fail(`${rel}: missing publishConfig.access:"public".`);
  }
}

// --check-npm: stubs at this version must already be on npm (Build bsdiff ran first).
if (checkNpm) {
  for (const name of stubNames) {
    const res = spawnSync("npm", ["view", `${name}@${version}`, "version", "--json"], {
      encoding: "utf8",
    });
    const ok = res.status === 0 && res.stdout.trim().includes(version);
    if (!ok) {
      fail(
        `${name}@${version} is not on npm yet — dispatch the "Build bsdiff" workflow to build + ` +
          `publish the platform stubs BEFORE publishing the main package.`,
      );
    }
  }
}

if (failures.length) {
  console.error(`\n✗ bsdiff release invariants failed (version ${version}):\n`);
  for (const f of failures) {
    console.error(`  • ${f}`);
  }
  console.error("\nSee memory project_bsdiff_publish_mechanics for the full publish flow.\n");
  process.exit(1);
}

console.log(
  `✓ bsdiff release invariants OK (version ${version}, ${stubs.length} stubs${checkNpm ? ", all on npm" : ""}).`,
);
