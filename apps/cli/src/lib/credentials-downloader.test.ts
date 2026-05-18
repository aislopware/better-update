import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import { downloadIosCredentials } from "./credentials-downloader";
import { MissingCredentialsError } from "./exit-codes";
import { failureError } from "./test-utils";

import type { ApiClient } from "../services/api-client";
import type { DownloadIosCredentialsOptions } from "./credentials-downloader";

// ── helpers ─────────────────────────────────────────────────────

const b64 = (raw: string) => Buffer.from(raw, "utf8").toString("base64");

interface ResolveStub {
  readonly ok?: ReadonlyMap<string, IosResolvePayload>;
  readonly notFound?: ReadonlySet<string>;
  readonly forbidden?: ReadonlySet<string>;
}

interface IosResolvePayload {
  readonly mobileprovisionBase64: string;
  readonly profileUuid: string | null;
  readonly ascApiKeyId: string | null;
}

const fakeP12 = b64("FAKE-P12-CONTENT-LONG-ENOUGH");

const mainPayload: IosResolvePayload = {
  mobileprovisionBase64: b64("MAIN-PROFILE-BYTES"),
  profileUuid: "uuid-main",
  ascApiKeyId: "asc-key-1",
};

const extensionPayload = (suffix: string): IosResolvePayload => ({
  mobileprovisionBase64: b64(`EXT-${suffix}-BYTES`),
  profileUuid: `uuid-${suffix}`,
  ascApiKeyId: "asc-key-1",
});

const fakeNotFound = (bundleId: string) => ({
  _tag: "NotFound" as const,
  message: `No iOS bundle configuration found for ${bundleId}`,
});

const fakeForbidden = () => ({
  _tag: "Forbidden" as const,
  message: "Permission denied",
});

const buildApi = (stub: ResolveStub): ApiClient => {
  const okMap = stub.ok ?? new Map<string, IosResolvePayload>();
  const notFound = stub.notFound ?? new Set<string>();
  const forbidden = stub.forbidden ?? new Set<string>();
  return {
    buildCredentials: {
      resolve: ({
        payload,
      }: {
        readonly payload: { readonly platform: string; readonly bundleIdentifier: string };
      }) => {
        const bundle = payload.bundleIdentifier;
        if (notFound.has(bundle)) {
          return Effect.fail(fakeNotFound(bundle));
        }
        if (forbidden.has(bundle)) {
          return Effect.fail(fakeForbidden());
        }
        const entry = okMap.get(bundle);
        if (!entry) {
          return Effect.fail(fakeNotFound(bundle));
        }
        return Effect.succeed({
          platform: "ios",
          distributionCertificate: { p12Base64: fakeP12, p12Password: "pw" },
          provisioningProfile: {
            mobileprovisionBase64: entry.mobileprovisionBase64,
            uuid: entry.profileUuid,
            name: "Test Profile",
            teamId: "TEAM1234",
            bundleIdentifier: bundle,
            distributionType: "APP_STORE",
          },
          pushKey: null,
          profileStale: false,
          currentDeviceRosterHash: null,
          context: {
            ascApiKeyId: entry.ascApiKeyId,
            distributionCertificateId: "cert-1",
            appleTeamId: "team-row-1",
            appleTeamIdentifier: "TEAM1234",
          },
        });
      },
    },
  } as unknown as ApiClient;
};

const baseOptions = (tempDir: string): DownloadIosCredentialsOptions => ({
  projectId: "project-1",
  mainBundleIdentifier: "com.example.app",
  bundleIdentifiers: ["com.example.app"],
  distribution: "app-store",
  tempDir,
});

const runWithTempDir = <Value, Err, R>(
  body: (tempDir: string) => Effect.Effect<Value, Err, R>,
): Effect.Effect<Value, Err, R> =>
  Effect.gen(function* () {
    const tempDir = yield* Effect.promise(async () => mkdtemp(path.join(os.tmpdir(), "bu-test-")));
    const result = yield* Effect.ensuring(
      body(tempDir),
      Effect.promise(async () => rm(tempDir, { recursive: true, force: true })),
    );
    return result;
  });

// ── tests ──────────────────────────────────────────────────────

describe(downloadIosCredentials, () => {
  it.effect("resolves all bundles cleanly without auto-provisioning", () =>
    runWithTempDir((tempDir) =>
      Effect.gen(function* () {
        const api = buildApi({
          ok: new Map([
            ["com.example.app", mainPayload],
            ["com.example.app.ext", extensionPayload("ext")],
          ]),
        });
        const result = yield* downloadIosCredentials(api, {
          ...baseOptions(tempDir),
          bundleIdentifiers: ["com.example.app", "com.example.app.ext"],
        });
        expect(result.profiles).toHaveLength(2);
        expect(result.profiles.map((profile) => profile.bundleIdentifier).toSorted()).toStrictEqual(
          ["com.example.app", "com.example.app.ext"],
        );
        expect(result.p12Password).toBe("pw");
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("fails when main bundle is not registered", () =>
    runWithTempDir((tempDir) =>
      Effect.gen(function* () {
        const api = buildApi({
          ok: new Map([["com.example.app.ext", extensionPayload("ext")]]),
          notFound: new Set(["com.example.app"]),
        });
        const exit = yield* Effect.exit(
          downloadIosCredentials(api, {
            ...baseOptions(tempDir),
            bundleIdentifiers: ["com.example.app", "com.example.app.ext"],
          }),
        );
        const err = failureError(exit);
        expect(err).toBeInstanceOf(MissingCredentialsError);
        expect(err?.message).toContain("Main app bundle");
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("fails fast on Forbidden — no auto-provision fallback", () =>
    runWithTempDir((tempDir) =>
      Effect.gen(function* () {
        const api = buildApi({
          ok: new Map([["com.example.app", mainPayload]]),
          forbidden: new Set(["com.example.app.ext"]),
        });
        const exit = yield* Effect.exit(
          downloadIosCredentials(api, {
            ...baseOptions(tempDir),
            bundleIdentifiers: ["com.example.app", "com.example.app.ext"],
          }),
        );
        const err = failureError(exit);
        expect(err).toBeInstanceOf(MissingCredentialsError);
        expect(err?.message).toContain("Permission denied");
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("fails when extensions missing AND server returns no ASC key for the team", () =>
    runWithTempDir((tempDir) =>
      Effect.gen(function* () {
        const api = buildApi({
          ok: new Map([["com.example.app", { ...mainPayload, ascApiKeyId: null }]]),
          notFound: new Set(["com.example.app.ext"]),
        });
        const exit = yield* Effect.exit(
          downloadIosCredentials(api, {
            ...baseOptions(tempDir),
            bundleIdentifiers: ["com.example.app", "com.example.app.ext"],
          }),
        );
        const err = failureError(exit);
        expect(err).toBeInstanceOf(MissingCredentialsError);
        expect(err?.message).toContain("no ASC API key is available");
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("rejects mainBundleIdentifier missing from bundleIdentifiers list", () =>
    runWithTempDir((tempDir) =>
      Effect.gen(function* () {
        const api = buildApi({ ok: new Map([["com.example.app", mainPayload]]) });
        const exit = yield* Effect.exit(
          downloadIosCredentials(api, {
            ...baseOptions(tempDir),
            mainBundleIdentifier: "com.example.other",
            bundleIdentifiers: ["com.example.app"],
          }),
        );
        const err = failureError(exit);
        expect(err).toBeInstanceOf(MissingCredentialsError);
        expect(err?.message).toContain("missing from bundleIdentifiers");
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
  );
});
