import { open } from "node:fs/promises";
import { createRequire } from "node:module";

import { BSDIFF40_MAGIC, hasBsdiff40Magic } from "@better-update/bsdiff/magic";
import { Context, Effect, Layer } from "effect";

import { BsdiffError } from "../lib/exit-codes";

// bsdiff producer port. The on-device bspatch that expo-updates 56 applies is
// the classic Colin Percival bsdiff-4.x / BSDIFF40 format: an 8-byte "BSDIFF40"
// magic, a 32-byte header, and three bzip2 streams (control/diff/extra). The
// first-party @better-update/bsdiff package (a napi-rs binding around the
// qbsdiff crate) emits that same format; its output applies byte-identically
// through expo's vendored bspatch.c (proven via the conformance round-trip gate).
//
// The binding is a native addon, isolated behind this port and loaded lazily at
// first `diff` call (not at layer init) — callers depend only on the Tag, so the
// binding source can change without touching them. We migrated off the legacy
// NAN/V8 `bsdiff-node` addon because it segfaults under bun (exit 133); napi-rs
// N-API is ABI-stable and loads cleanly under bun.
//
// MANDATORY pre-ship gate (tracked in followups, NOT covered by unit tests):
// round-trip a real Hermes base+new pair through @better-update/bsdiff, apply
// with expo's vendored bspatch.c (or an SDK-56 device), assert
// SHA-256(output) === new hash.
//
// BSDIFF40_MAGIC + hasBsdiff40Magic are imported from @better-update/bsdiff/magic
// (the package's only hand-written source) so this load-bearing format invariant
// is defined once and cannot drift between the producer package and the CLI.

export interface BsdiffDiffInput {
  /** The base bundle the device already has (bspatch `oldfile`). */
  readonly baseFilePath: string;
  /** The new bundle being published (bspatch `newfile`). */
  readonly newFilePath: string;
  /** Where to write the produced BSDIFF40 patch. */
  readonly outPath: string;
}

export class BsdiffService extends Context.Tag("cli/BsdiffService")<
  BsdiffService,
  {
    readonly diff: (input: BsdiffDiffInput) => Effect.Effect<void, BsdiffError>;
  }
>() {}

interface BsdiffBinding {
  readonly diffSync: (oldFile: string, newFile: string, patchFile: string) => unknown;
}

const isBsdiffBinding = (value: unknown): value is BsdiffBinding =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { diffSync?: unknown }).diffSync === "function";

const loadBinding = Effect.gen(function* () {
  // createRequire keeps the native addon a runtime require, never a static
  // import, so the napi-rs loader (index.js + the platform .node binary)
  // resolves at runtime against the installed @better-update/bsdiff package
  // instead of being pulled into the ESM bundle. tsdown's `noExternal`
  // @better-update/* rule only rewrites static imports, so this dynamic require
  // stays external — same pattern node-pty uses.
  const loaded = yield* Effect.try({
    try: (): unknown => createRequire(import.meta.url)("@better-update/bsdiff"),
    catch: (cause) =>
      new BsdiffError({
        message:
          "Failed to load the @better-update/bsdiff native addon. Patch generation is unavailable in " +
          `this runtime (the prebuilt binary may be missing for this platform): ${String(cause)}`,
      }),
  });
  if (!isBsdiffBinding(loaded)) {
    return yield* new BsdiffError({
      message: "@better-update/bsdiff loaded but does not expose a diffSync function.",
    });
  }
  return loaded;
});

/** Read the first `length` bytes of a file without loading the whole thing. */
const readMagic = (filePath: string, length: number): Effect.Effect<string, BsdiffError> =>
  Effect.tryPromise({
    try: async () => {
      const handle = await open(filePath, "r");
      try {
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, 0);
        return buffer.subarray(0, bytesRead).toString("latin1");
      } finally {
        await handle.close();
      }
    },
    catch: (cause) =>
      new BsdiffError({ message: `Failed to read produced patch ${filePath}: ${String(cause)}` }),
  });

export const BsdiffServiceLive = Layer.succeed(BsdiffService, {
  diff: (input: BsdiffDiffInput) =>
    Effect.gen(function* () {
      const binding = yield* loadBinding;

      // diffSync(oldFile, newFile, patchFile): old=base, new=target.
      yield* Effect.try({
        try: () => binding.diffSync(input.baseFilePath, input.newFilePath, input.outPath),
        catch: (cause) =>
          new BsdiffError({
            message: `bsdiff failed to compute a patch (base=${input.baseFilePath}, new=${input.newFilePath}): ${String(cause)}`,
          }),
      });

      // Cheap self-check: a valid producer must emit the BSDIFF40 magic the
      // on-device bspatch hard-checks with memcmp. A mismatch means the addon
      // produced an incompatible format and the patch would fail to apply.
      const magic = yield* readMagic(input.outPath, BSDIFF40_MAGIC.length);
      if (!hasBsdiff40Magic(Buffer.from(magic, "latin1"))) {
        return yield* new BsdiffError({
          message: `Produced patch is not a BSDIFF40 stream (got magic ${JSON.stringify(magic)}); refusing to upload an unapplyable patch.`,
        });
      }
      return undefined;
    }),
});
