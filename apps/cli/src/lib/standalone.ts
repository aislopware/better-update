/**
 * True when running inside the `bun build --compile` single binary: the bundle
 * lives on Bun's virtual filesystem (`/$bunfs/...` on POSIX, `B:\~BUN\...` on
 * Windows) instead of a real path. Under `bun src/index.ts` / `bun dist/…` this
 * is false and `process.execPath` is the bun runtime, not the CLI.
 */
export const isStandaloneBinary = (): boolean =>
  import.meta.filename.includes("$bunfs") || import.meta.filename.includes("~BUN");
