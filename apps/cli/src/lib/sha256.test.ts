import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { BuildFailedError } from "./exit-codes";
import { sha256File, sha256FileBase64Url, sha256Namespaced } from "./sha256";
import { failureError } from "./test-utils";

// ── fixtures ──────────────────────────────────────────────────────

const HELLO_WORLD = "hello world";
const HELLO_WORLD_SHA256 = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";

// ── helpers ───────────────────────────────────────────────────────

const withTempFile = <A>(
  content: Buffer,
  run: (path: string) => Effect.Effect<A, BuildFailedError>,
) =>
  Effect.gen(function* () {
    const dir = mkdtempSync(join(tmpdir(), "sha256-test-"));
    const filePath = join(dir, "fixture.bin");
    writeFileSync(filePath, content);
    const result = yield* run(filePath).pipe(
      Effect.ensuring(Effect.sync(() => rmSync(dir, { recursive: true, force: true }))),
    );
    return result;
  });

// ── tests ─────────────────────────────────────────────────────────

describe(sha256File, () => {
  it.effect('computes known SHA-256 for "hello world"', () =>
    Effect.gen(function* () {
      const result = yield* withTempFile(Buffer.from(HELLO_WORLD, "utf8"), (path) =>
        sha256File(path),
      );
      expect(result.sha256).toBe(HELLO_WORLD_SHA256);
      expect(result.byteSize).toBe(HELLO_WORLD.length);
    }),
  );

  it.effect("handles an empty file", () =>
    Effect.gen(function* () {
      const result = yield* withTempFile(Buffer.alloc(0), (path) => sha256File(path));
      // SHA-256 of empty input
      expect(result.sha256).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );
      expect(result.byteSize).toBe(0);
    }),
  );

  it.effect("streams larger content without loading all into memory", () =>
    Effect.gen(function* () {
      // 1 MiB of zeros
      const buf = Buffer.alloc(1_048_576, 0);
      const result = yield* withTempFile(buf, (path) => sha256File(path));
      expect(result.byteSize).toBe(1_048_576);
      expect(result.sha256).toHaveLength(64);
    }),
  );

  it.effect("fails with BuildFailedError on non-existent path", () =>
    Effect.gen(function* () {
      const exit = yield* sha256File("/nonexistent-path-for-test-xyz").pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      expect(failureError(exit)).toBeInstanceOf(BuildFailedError);
    }),
  );
});

describe(sha256FileBase64Url, () => {
  it.effect('computes a base64url SHA-256 digest for "hello world"', () =>
    Effect.gen(function* () {
      const result = yield* withTempFile(Buffer.from(HELLO_WORLD, "utf8"), (path) =>
        sha256FileBase64Url(path),
      );
      expect(result.sha256Base64Url).toBe("uU0nuZNNPgilLlLX2n2r-sSE7-N6U4DukIj3rOLvzek");
      expect(result.byteSize).toBe(HELLO_WORLD.length);
    }),
  );
});

describe(sha256Namespaced, () => {
  test("produces different hashes for same content with different content types", () => {
    const jsHash = sha256Namespaced("application/javascript", HELLO_WORLD_SHA256);
    const textHash = sha256Namespaced("text/plain", HELLO_WORLD_SHA256);

    expect(jsHash).not.toBe(textHash);
    expect(jsHash).not.toBe(HELLO_WORLD_SHA256);
  });

  test("produces same hash for same content type + content hash", () => {
    const a = sha256Namespaced("application/javascript", HELLO_WORLD_SHA256);
    const b = sha256Namespaced("application/javascript", HELLO_WORLD_SHA256);
    expect(a).toBe(b);
  });

  test("returns base64url-encoded string", () => {
    const result = sha256Namespaced("application/javascript", HELLO_WORLD_SHA256);
    // base64url: no +, /, or =
    expect(result).toMatch(/^[A-Za-z0-9_-]+$/u);
  });
});
