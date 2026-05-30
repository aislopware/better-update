# Conformance fixtures

Trusted base for the `@better-update/bsdiff` ship gate. Everything here is the
_verifier_ side — the real on-device patcher and its launcher. The harness
([`../run-conformance.mjs`](../run-conformance.mjs)) compiles these, then feeds
them a patch produced by **this package** and asserts byte-identical
reconstruction.

## `bspatch.c` — vendored verbatim, pinned

Copied **unmodified** from expo-updates, SDK 56:

```
https://raw.githubusercontent.com/expo/expo/sdk-56/packages/expo-updates/vendor/bspatch/bspatch.c
```

Pinned SHA-256 (asserted at runtime by the harness — a mismatch fails the gate):

```
17982b286d43583aa850c022a87db83e63b3d256b2c7822cf58d960674581d8b
```

This is the _exact_ C an SDK-56 device runs to apply an OTA bundle patch. It is
classic Colin Percival bsdiff-4.x: it hard-checks `memcmp(header, "BSDIFF40", 8)`
and decodes three sequential bzip2 streams (control / diff / extra). The
entrypoint is `int bspatch_main(int argc, char *argv[])` — there is no `main()`,
because expo links it into a native module rather than a standalone binary.

To re-vendor (e.g. when bumping the target SDK) re-run the `curl` above and
update the pinned hash here **and** in `run-conformance.mjs`. Do not hand-edit
`bspatch.c`; the whole point of the gate is that it is the unmodified upstream.

## `wrapper.c` — thin `main()`

Supplies the `main()` that `bspatch.c` omits and forwards argv verbatim
(`bspatch <oldfile> <newfile> <patchfile>`). Deliberately trivial so the only
behaviour under test is the unmodified `bspatch.c`.

## Test vectors — representative blobs, NOT a real `.hbc`

The harness generates its `(base, new)` pair at runtime: JS-bundle-shaped byte
blobs (a metro-style IIFE prologue + a long body, mutated for the `new` side).
They exercise the bsdiff control/diff/extra stream split with realistic
insert + copy regions.

> **Caveat — these are NOT a hermesc-compiled `.hbc`.** Ideally the gate would
> diff a real Hermes bytecode bundle (the actual OTA payload shape). No `hermesc`
> is available in this environment, so we use representative blobs instead. The
> format contract being proven — qbsdiff's `BSDIFF40` output applies
> byte-identically through expo's unmodified `bspatch.c` — is independent of the
> payload's internal structure: `bspatch` treats both inputs as opaque bytes.
> When a hermesc toolchain is wired into CI, drop a real `.hbc` pair into this
> directory and point the harness at it to upgrade the fixture from
> "representative" to "production-shaped". This is tracked as a followup.
