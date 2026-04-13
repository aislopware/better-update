import { FileSystem } from "@effect/platform";
import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { downloadAndroidCredentials, downloadIosCredentials } from "./credentials-downloader";
import { MissingCredentialsError } from "./exit-codes";
import { failureError } from "./test-utils";

import type { ApiClient } from "../services/api-client";

// ── stubs ─────────────────────────────────────────────────────────

interface StubOptions {
  readonly list?: (args: {
    urlParams: Record<string, string>;
  }) => Effect.Effect<{ items: ReadonlyArray<unknown> }, unknown>;
  readonly download?: (args: { path: { id: string } }) => Effect.Effect<
    {
      blob: string;
      password: string | null;
      keyAlias: string | null;
      keyPassword: string | null;
      filename: string;
      contentType: string;
    },
    unknown
  >;
}

const makeApi = (opts: StubOptions): ApiClient =>
  ({
    credentials: {
      list: opts.list ?? (() => Effect.succeed({ items: [] })),
      download:
        opts.download ??
        (() =>
          Effect.succeed({
            blob: "",
            password: null,
            keyAlias: null,
            keyPassword: null,
            filename: "",
            contentType: "",
          })),
    },
  }) as unknown as ApiClient;

// Collect writes for verification. Returns the FileSystem layer + a reader for writes.
const makeFsCollector = () => {
  const writes: Array<{ path: string; bytes: Uint8Array }> = [];
  const chmods: Array<{ path: string; mode: number }> = [];
  const fsLayer = FileSystem.layerNoop({
    writeFile: (path: string, bytes: Uint8Array) =>
      Effect.sync(() => {
        writes.push({ path, bytes });
      }),
    chmod: (path: string, mode: number) =>
      Effect.sync(() => {
        chmods.push({ path, mode });
      }),
  });
  return { fsLayer, writes, chmods };
};

const activeCred = (
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  organizationId: "org_1",
  projectId: "proj_1",
  platform: "ios",
  type: "distribution-certificate",
  name: "Test Cert",
  distribution: null,
  isActive: true,
  metadata: "{}",
  expiresAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const base64 = (s: string) => Buffer.from(s).toString("base64");

// ── iOS tests ─────────────────────────────────────────────────────

describe(downloadIosCredentials, () => {
  it.effect("fails with MissingCredentialsError when no active cert exists", () =>
    Effect.gen(function* () {
      const api = makeApi({ list: () => Effect.succeed({ items: [] }) });
      const { fsLayer } = makeFsCollector();
      const exit = yield* downloadIosCredentials(api, {
        projectId: "proj_1",
        distribution: "app-store",
        tempDir: "/tmp/test",
      }).pipe(Effect.provide(fsLayer), Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error).toBeInstanceOf(MissingCredentialsError);
        expect((error as MissingCredentialsError).hint).toContain(
          "better-update credentials upload",
        );
      }
    }),
  );

  it.effect("writes p12 + profile with chmod 0o600 and returns metadata", () =>
    Effect.gen(function* () {
      const api = makeApi({
        list: (args) => {
          const urlType = args.urlParams["type"];
          if (urlType === "distribution-certificate") {
            return Effect.succeed({
              items: [activeCred("cert_1", { type: "distribution-certificate" })],
            });
          }
          return Effect.succeed({
            items: [
              activeCred("profile_1", {
                type: "provisioning-profile",
                distribution: "app-store",
              }),
            ],
          });
        },
        download: (args) => {
          if (args.path.id === "cert_1") {
            return Effect.succeed({
              blob: base64("<p12-bytes>"),
              password: "p12-password",
              keyAlias: null,
              keyPassword: null,
              filename: "cert.p12",
              contentType: "application/x-pkcs12",
            });
          }
          return Effect.succeed({
            blob: base64("<profile-bytes>"),
            password: null,
            keyAlias: null,
            keyPassword: null,
            filename: "AppStore.mobileprovision",
            contentType: "application/octet-stream",
          });
        },
      });

      const { fsLayer, writes, chmods } = makeFsCollector();
      const result = yield* downloadIosCredentials(api, {
        projectId: "proj_1",
        distribution: "app-store",
        tempDir: "/tmp/test",
      }).pipe(Effect.provide(fsLayer));

      expect(result.p12Path).toBe("/tmp/test/cert.p12");
      expect(result.p12Password).toBe("p12-password");
      expect(result.profilePath).toBe("/tmp/test/profile.mobileprovision");
      expect(result.profileFilename).toBe("AppStore.mobileprovision");

      expect(writes).toHaveLength(2);
      expect(writes[0]?.path).toBe("/tmp/test/cert.p12");
      expect(writes[1]?.path).toBe("/tmp/test/profile.mobileprovision");
      expect(chmods).toHaveLength(2);
      expect(chmods.every((c) => c.mode === 0o600)).toBe(true);
    }),
  );

  it.effect("fails when no active provisioning profile matches the distribution", () =>
    Effect.gen(function* () {
      const api = makeApi({
        list: (args) => {
          if (args.urlParams["type"] === "distribution-certificate") {
            return Effect.succeed({ items: [activeCred("cert_1")] });
          }
          // no profiles returned for provisioning-profile list
          return Effect.succeed({ items: [] });
        },
        download: () =>
          Effect.succeed({
            blob: base64("x"),
            password: "",
            keyAlias: null,
            keyPassword: null,
            filename: "cert.p12",
            contentType: "application/x-pkcs12",
          }),
      });
      const { fsLayer } = makeFsCollector();
      const exit = yield* downloadIosCredentials(api, {
        projectId: "proj_1",
        distribution: "ad-hoc",
        tempDir: "/tmp/test",
      }).pipe(Effect.provide(fsLayer), Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect((error as MissingCredentialsError).hint).toContain("ad-hoc");
      }
    }),
  );
});

// ── Android tests ─────────────────────────────────────────────────

describe(downloadAndroidCredentials, () => {
  it.effect("fails with MissingCredentialsError when no active keystore exists", () =>
    Effect.gen(function* () {
      const api = makeApi({ list: () => Effect.succeed({ items: [] }) });
      const { fsLayer } = makeFsCollector();
      const exit = yield* downloadAndroidCredentials(api, {
        projectId: "proj_1",
        tempDir: "/tmp/test",
      }).pipe(Effect.provide(fsLayer), Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error).toBeInstanceOf(MissingCredentialsError);
      }
    }),
  );

  it.effect("writes keystore with chmod 0o600 and returns credentials", () =>
    Effect.gen(function* () {
      const api = makeApi({
        list: () =>
          Effect.succeed({
            items: [
              activeCred("keystore_1", {
                platform: "android",
                type: "keystore",
              }),
            ],
          }),
        download: () =>
          Effect.succeed({
            blob: base64("<keystore-bytes>"),
            password: "store-pass",
            keyAlias: "my-key",
            keyPassword: "key-pass",
            filename: "release.keystore",
            contentType: "application/octet-stream",
          }),
      });

      const { fsLayer, writes, chmods } = makeFsCollector();
      const result = yield* downloadAndroidCredentials(api, {
        projectId: "proj_1",
        tempDir: "/tmp/test",
      }).pipe(Effect.provide(fsLayer));

      expect(result.keystorePath).toBe("/tmp/test/release.keystore");
      expect(result.storePassword).toBe("store-pass");
      expect(result.keyAlias).toBe("my-key");
      expect(result.keyPassword).toBe("key-pass");

      expect(writes).toHaveLength(1);
      expect(writes[0]?.path).toBe("/tmp/test/release.keystore");
      expect(chmods).toHaveLength(1);
      expect(chmods[0]?.mode).toBe(0o600);
    }),
  );

  it.effect("fails when keystore download has null keyAlias or password", () =>
    Effect.gen(function* () {
      const api = makeApi({
        list: () =>
          Effect.succeed({
            items: [
              activeCred("keystore_1", {
                platform: "android",
                type: "keystore",
              }),
            ],
          }),
        download: () =>
          Effect.succeed({
            blob: base64("x"),
            password: "store-pass",
            keyAlias: null,
            keyPassword: "key-pass",
            filename: "release.keystore",
            contentType: "application/octet-stream",
          }),
      });

      const { fsLayer } = makeFsCollector();
      const exit = yield* downloadAndroidCredentials(api, {
        projectId: "proj_1",
        tempDir: "/tmp/test",
      }).pipe(Effect.provide(fsLayer), Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );
});
