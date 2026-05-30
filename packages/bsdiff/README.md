# @better-update/bsdiff

First-party bsdiff patch **producer** for better-update, written in Rust and
exposed via napi-rs (N-API v3). Wraps the [`qbsdiff`](https://crates.io/crates/qbsdiff)
crate (v1.4.4) to emit classic bsdiff-4.x (`BSDIFF40`) patches: an 8-byte magic,
a 32-byte header, and three bzip2 streams (control/diff/extra) — exactly the
format expo-updates 56's vendored `bspatch.c` applies on device.

It replaces `bsdiff-node@2.5.0`, a legacy NAN/V8 addon that **segfaults under bun**
(exit 133 — JSC is not V8). N-API is ABI-stable and loads under bun (same loader
mechanism as `@napi-rs/keyring`, already used in `packages/credentials-crypto`).

## API

```ts
// Native binding (auto-generated index.js / index.d.ts from `napi build`):
diffSync(oldPath: string, newPath: string, outPath: string): void
diffBuffer(old: Buffer, new: Buffer): Buffer

// Pure helper shim:
import { BSDIFF40_MAGIC, hasBsdiff40Magic } from "@better-update/bsdiff/magic";
```

`diffSync` mirrors the signature the CLI's `BsdiffService` already drives, so the
binding source can be swapped without touching the Effect port.

## Build

```bash
bun run build              # napi build --platform --release → host .node + index.js/.d.ts
bun run test               # vitest unit tests for the pure shim (NO C compiled)
bun run test:conformance   # the SHIP GATE — see below (needs build + libbz2 + C compiler)
```

The native artifacts (`*.node`, `index.js`, `index.d.ts`, `target/`) are
git-ignored and rebuilt by `napi build`.

## Cross-platform prebuilts (CI — FOLLOWUP)

Only the **host** (darwin-arm64) binary is built locally. The other seven targets
in `package.json` `napi.targets` (darwin-x64, linux x64/arm64 gnu+musl, win32
x64/arm64 msvc) require CI runners / cross-compile and are produced by
`.github/workflows/build-bsdiff.yml` (scaffolded, **not yet wired** into release).

The per-platform binaries publish as the `optionalDependencies` split packages
(scaffolded under `npm/<platform>/`); the main package's auto-generated loader
picks the right one at runtime. To ship: flip this package to `private: false`,
run the publish job (`napi prepublish -t npm`), then publish the main package.

## Conformance gate — the bsdiff ship-gate

qbsdiff is format-_compatible_ with classic bsdiff-4.x but a **different
implementation** than the `bsdiff-node` it replaces. "Same format" is a claim;
byte-identical reconstruction is only proven by feeding a real patch through the
real on-device patcher. `conformance/` is that proof, codified as a reproducible
harness — and it is the gate that must be green before shipping the producer.

```bash
bun run build              # first: produce the host .node addon
bun run test:conformance   # == node conformance/run-conformance.mjs
```

`conformance/run-conformance.mjs` (exit 0 = PASS, non-zero = do-not-ship):

1. asserts `conformance/fixtures/bspatch.c` matches the pinned expo SDK-56
   sha256 `17982b286d43583aa850c022a87db83e63b3d256b2c7822cf58d960674581d8b`
   (the _unmodified_ on-device patcher — tampering fails the gate);
2. compiles it + the thin `wrapper.c` `main()` —
   macOS: `/usr/bin/clang -I/opt/homebrew/opt/bzip2/include -L/opt/homebrew/opt/bzip2/lib -lbz2`
   (keg-only `brew install bzip2`); Linux: `cc … -lbz2` (`apt-get install -y libbz2-dev`);
3. produces a `BSDIFF40` patch via this package's `diffSync`;
4. applies it with the compiled `bspatch` and asserts **SHA-256(out) == SHA-256(new)**;
5. negative control A — a bad-magic patch is rejected;
6. negative control B — applying against the wrong base diverges from `new`.

> **Test vectors are representative blobs, not a real hermesc `.hbc`** (no
> hermesc in this env). `bspatch` treats inputs as opaque bytes, so the
> format-compat proof is payload-shape-independent; see
> [`conformance/fixtures/README.md`](conformance/fixtures/README.md) for the
> caveat and how to upgrade to a production `.hbc` fixture.

### Why it is NOT in `bun run test`

The gate compiles C against libbz2. The unit run (`bun run test`) must never
compile C, so the harness is excluded in `vitest.config.ts`
(`include: ["src/**/*.test.ts"]`, `exclude: ["conformance/**", …]`) and lives in
the dedicated `test:conformance` script + the
[`.github/workflows/conformance-bsdiff.yml`](../../.github/workflows/conformance-bsdiff.yml)
CI job (ubuntu + macOS), which builds the addon, installs libbz2, and runs the
gate. A non-zero exit blocks the merge/ship.
