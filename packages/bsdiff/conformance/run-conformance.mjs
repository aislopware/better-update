#!/usr/bin/env node
// @ts-check
/*
 * bsdiff conformance gate — the @better-update/bsdiff SHIP GATE.
 *
 * Proves that the BSDIFF40 patch this package produces (via the qbsdiff crate)
 * applies byte-identically through expo-updates SDK-56's *unmodified* on-device
 * patcher, and that the patcher correctly rejects malformed / mismatched input.
 *
 * qbsdiff is format-compatible with classic bsdiff-4.x but is a DIFFERENT
 * implementation than the legacy `bsdiff-node` it replaces. "Same format" is a
 * claim, not a proof — only feeding a real patch through the real C patcher and
 * checking the reconstructed bytes proves it. That is what this script does.
 *
 * It is intentionally NOT part of `bun run test` (the vitest unit run): it needs
 * a C compiler + libbz2 and the built native addon, so it lives in a dedicated
 * `test:conformance` script + CI job. See conformance/README.md.
 *
 * Run from the package root:
 *     bun run build            # ensure the host .node addon exists
 *     bun run test:conformance # == node conformance/run-conformance.mjs
 *
 * Exit 0 = gate PASS. Any non-zero exit = gate FAIL (do not ship).
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures");
const PKG_ROOT = join(HERE, "..");

/** Pinned SHA-256 of the vendored expo SDK-56 bspatch.c (see fixtures/README.md). */
const BSPATCH_C_SHA256 = "17982b286d43583aa850c022a87db83e63b3d256b2c7822cf58d960674581d8b";

const BSDIFF40_MAGIC = "BSDIFF40";

const sha256 = (/** @type {Buffer | Uint8Array} */ bytes) =>
  createHash("sha256").update(bytes).digest("hex");

let stepNo = 0;
const pass = (/** @type {string} */ msg) => {
  stepNo += 1;
  console.log(`  ✓ [${stepNo}] ${msg}`);
};
const fail = (/** @type {string} */ msg) => {
  console.error(`\n  ✗ GATE FAIL: ${msg}\n`);
  process.exit(1);
};

console.log("bsdiff conformance gate (qbsdiff ↔ expo SDK-56 bspatch.c)\n");

// ── 0. Compiler flags (documented, platform-specific) ──────────────────────
//
// macOS ships NO libbz2 dev files; install via `brew install bzip2` — it is a
// keg-only formula at /opt/homebrew/opt/bzip2 (static libbz2.a + bzlib.h).
// The shell's `cc` is often aliased, so we invoke /usr/bin/clang directly.
//
// Linux: `apt-get install -y libbz2-dev` puts bzlib.h + libbz2 on the default
// search path, so no extra -I/-L is needed; the system `cc` is fine.
const isMac = platform() === "darwin";
const BREW_BZIP2 = process.env.BZIP2_PREFIX ?? "/opt/homebrew/opt/bzip2";
const compiler = isMac ? "/usr/bin/clang" : (process.env.CC ?? "cc");
const platformCflags = isMac ? [`-I${BREW_BZIP2}/include`, `-L${BREW_BZIP2}/lib`] : [];

// ── tmp workspace (out of repo; cleaned up on exit) ─────────────────────────
const work = mkdtempSync(join(tmpdir(), "bsdiff-conformance-"));
let exitCode = 0;
try {
  // ── 1. Assert the vendored bspatch.c is the pinned upstream ───────────────
  const bspatchSrc = join(FIXTURES, "bspatch.c");
  const wrapperSrc = join(FIXTURES, "wrapper.c");
  const actualSha = sha256(readFileSync(bspatchSrc));
  if (actualSha !== BSPATCH_C_SHA256) {
    fail(
      `vendored bspatch.c sha256 mismatch.\n      expected ${BSPATCH_C_SHA256}\n      actual   ${actualSha}\n      The verifier base is not the unmodified expo SDK-56 bspatch.c. Re-vendor and re-pin.`,
    );
  }
  pass(`vendored bspatch.c matches pinned expo SDK-56 sha256 (${BSPATCH_C_SHA256.slice(0, 12)}…)`);

  // ── 2. Compile the real on-device patcher ─────────────────────────────────
  const bspatchBin = join(work, isMac ? "bspatch" : "bspatch.out");
  try {
    execFileSync(compiler, [bspatchSrc, wrapperSrc, ...platformCflags, "-lbz2", "-o", bspatchBin], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (cause) {
    fail(
      `failed to compile bspatch.c with ${compiler}.\n      ${String(cause)}\n      macOS: \`brew install bzip2\` (keg-only @ ${BREW_BZIP2}).\n      linux: \`sudo apt-get install -y libbz2-dev\`.`,
    );
  }
  pass(`compiled bspatch.c + wrapper.c with ${compiler} ${platformCflags.join(" ")} -lbz2`);

  // ── 3. Load THIS package's native producer (the runtime path the CLI uses) ─
  const require = createRequire(import.meta.url);
  /** @type {{ diffSync: (o: string, n: string, p: string) => void }} */
  let bsdiff;
  try {
    bsdiff = require(PKG_ROOT);
  } catch (cause) {
    fail(
      `failed to load @better-update/bsdiff native addon from ${PKG_ROOT}.\n      ${String(cause)}\n      Run \`bun run build\` first to produce the host .node binary.`,
    );
  }
  if (typeof bsdiff.diffSync !== "function") {
    fail("@better-update/bsdiff loaded but does not expose diffSync");
  }
  pass("loaded @better-update/bsdiff native producer (diffSync)");

  // ── 4. Build a representative (base, new) pair ────────────────────────────
  //
  // JS-bundle-shaped blobs: a metro-style IIFE prologue + a long body, mutated
  // on the `new` side to exercise copy + insert regions. NOT a real hermesc
  // .hbc — see fixtures/README.md for the caveat. bspatch treats both inputs as
  // opaque bytes, so the format-compat proof is payload-shape-independent.
  const prologue = "(function(global){var __r=global.require,__d=global.__d;'use strict';";
  const base = Buffer.from(`${prologue}var m=${"a1b2".repeat(2048)};})(this);`, "utf8");
  const next = Buffer.from(
    `${prologue}var m=${"a1b2".repeat(1900)}${"c3d4".repeat(160)};__r(0);})(this);`,
    "utf8",
  );
  const baseFile = join(work, "base.bundle");
  const newFile = join(work, "new.bundle");
  writeFileSync(baseFile, base);
  writeFileSync(newFile, next);
  const newSha = sha256(next);
  pass(`built representative base (${base.length} B) + new (${next.length} B) bundles`);

  // ── 5. Produce a patch with @better-update/bsdiff ─────────────────────────
  const patchFile = join(work, "patch.bsdiff");
  bsdiff.diffSync(baseFile, newFile, patchFile);
  const patch = readFileSync(patchFile);
  const patchMagic = patch.subarray(0, 8).toString("latin1");
  if (patchMagic !== BSDIFF40_MAGIC) {
    fail(`produced patch magic is ${JSON.stringify(patchMagic)}, expected "${BSDIFF40_MAGIC}"`);
  }
  pass(`produced ${patch.length}-byte patch with ${BSDIFF40_MAGIC} magic`);

  // ── 6. Apply with the real bspatch + assert byte-identical reconstruction ─
  const outFile = join(work, "out.bundle");
  try {
    execFileSync(bspatchBin, [baseFile, outFile, patchFile], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (cause) {
    fail(`bspatch failed to apply a valid qbsdiff patch.\n      ${String(cause)}`);
  }
  const outSha = sha256(readFileSync(outFile));
  if (outSha !== newSha) {
    fail(
      `reconstruction mismatch.\n      SHA-256(bspatch output) = ${outSha}\n      SHA-256(new bundle)     = ${newSha}\n      qbsdiff's BSDIFF40 output did NOT apply byte-identically through expo's bspatch.c.`,
    );
  }
  pass(
    `bspatch reconstruction is byte-identical: SHA-256(out) == SHA-256(new) (${newSha.slice(0, 12)}…)`,
  );

  // ── 7. Negative control A: bad magic must be rejected ─────────────────────
  // bspatch.c hard-checks memcmp(header, "BSDIFF40", 8); a junk patch must NOT
  // be applied (non-zero exit), proving the magic gate is live.
  const badMagicFile = join(work, "bad-magic.patch");
  const badMagic = Buffer.concat([Buffer.from("NOTBSDIF", "latin1"), patch.subarray(8)]);
  writeFileSync(badMagicFile, badMagic);
  let badMagicRejected = false;
  try {
    execFileSync(bspatchBin, [baseFile, join(work, "bad-magic.out"), badMagicFile], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    badMagicRejected = true;
  }
  if (!badMagicRejected) {
    fail("bspatch accepted a patch with a corrupted magic header (should reject)");
  }
  pass("negative control A: bad-magic patch rejected by bspatch");

  // ── 8. Negative control B: wrong base must diverge ────────────────────────
  // A valid patch applied against the WRONG base must not reconstruct `new`.
  // (bspatch may exit 0 — bsdiff has no whole-file checksum — but the output
  // bytes must differ. We assert divergence, accepting either outcome.)
  const wrongBaseFile = join(work, "wrong-base.bundle");
  writeFileSync(
    wrongBaseFile,
    Buffer.from(`${prologue}var z=${"9z8y".repeat(2048)};})(this);`, "utf8"),
  );
  const wrongOut = join(work, "wrong-base.out");
  let wrongBaseDiverged = false;
  try {
    execFileSync(bspatchBin, [wrongBaseFile, wrongOut, patchFile], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    wrongBaseDiverged = sha256(readFileSync(wrongOut)) !== newSha;
  } catch {
    // bspatch refused the wrong base outright — also a valid divergence.
    wrongBaseDiverged = true;
  }
  if (!wrongBaseDiverged) {
    fail("applying the patch to a WRONG base reconstructed `new` (should diverge)");
  }
  pass("negative control B: wrong-base apply diverges from new");

  console.log("\n  GATE PASS — qbsdiff BSDIFF40 output is bspatch.c-applyable; controls hold.\n");
} catch (cause) {
  console.error(`\n  unexpected harness error: ${String(cause)}\n`);
  exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(exitCode);
