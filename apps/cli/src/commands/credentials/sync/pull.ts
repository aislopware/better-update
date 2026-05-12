import path from "node:path";

import { fromBase64 } from "@better-update/encoding";
import { FileSystem } from "@effect/platform";
import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../../../lib/citty-effect";
import { writeCredentialsJson } from "../../../lib/credentials-json";
import { CredentialsJsonError } from "../../../lib/exit-codes";
import { formatCause } from "../../../lib/format-error";
import { printHuman, printTable } from "../../../lib/output";
import { apiClient } from "../../../services/api-client";
import { CliRuntime } from "../../../services/cli-runtime";
import {
  buildIosFromMeta,
  ensureGitignoreEntries,
  SYNC_EXIT_EXTRAS,
  writeArtifact,
  writeText,
} from "./helpers";

import type { CredentialsJson } from "../../../lib/credentials-json";
import type { ApiClient } from "../../../services/api-client";
import type { PullRow } from "./helpers";

interface IosListItems {
  readonly certFirst: { readonly id: string; readonly serialNumber: string } | undefined;
  readonly profileFirst: { readonly id: string; readonly bundleIdentifier: string } | undefined;
  readonly pushFirst: { readonly id: string; readonly keyId: string } | undefined;
  readonly ascFirst: { readonly id: string; readonly name: string } | undefined;
}

const fetchIosListing = (api: ApiClient): Effect.Effect<IosListItems, CredentialsJsonError> =>
  Effect.gen(function* () {
    const [certs, profiles, pushKeys, ascKeys] = yield* Effect.all(
      [
        api.appleDistributionCertificates.list(),
        api.appleProvisioningProfiles.list({ urlParams: {} }),
        api.applePushKeys.list(),
        api.ascApiKeys.list(),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.mapError(
        (cause) =>
          new CredentialsJsonError({
            message: `Failed to list iOS credentials: ${formatCause(cause)}`,
          }),
      ),
    );
    return {
      certFirst: certs.items.at(0),
      profileFirst: profiles.items.at(0),
      pushFirst: pushKeys.items.at(0),
      ascFirst: ascKeys.items.at(0),
    };
  });

const downloadIosDistCert = (
  api: ApiClient,
  fs: FileSystem.FileSystem,
  projectRoot: string,
  keysDir: string,
  id: string,
) =>
  Effect.gen(function* () {
    const data = yield* api.appleDistributionCertificates.download({ path: { id } }).pipe(
      Effect.mapError(
        (cause) =>
          new CredentialsJsonError({
            message: `Failed to download distribution certificate: ${formatCause(cause)}`,
          }),
      ),
    );
    const rel = path.join(keysDir, `${data.id}.p12`);
    yield* writeArtifact(fs, projectRoot, rel, fromBase64(data.p12Base64));
    return { rel, password: data.p12Password, id: data.id };
  });

const downloadProvisioningProfile = (
  api: ApiClient,
  fs: FileSystem.FileSystem,
  projectRoot: string,
  keysDir: string,
  id: string,
) =>
  Effect.gen(function* () {
    const data = yield* api.appleProvisioningProfiles.download({ path: { id } }).pipe(
      Effect.mapError(
        (cause) =>
          new CredentialsJsonError({
            message: `Failed to download provisioning profile: ${formatCause(cause)}`,
          }),
      ),
    );
    const rel = path.join(keysDir, `${data.id}.mobileprovision`);
    yield* writeArtifact(fs, projectRoot, rel, fromBase64(data.profileBase64));
    return { rel, id: data.id };
  });

const downloadIosPushKey = (
  api: ApiClient,
  fs: FileSystem.FileSystem,
  projectRoot: string,
  keysDir: string,
  id: string,
) =>
  Effect.gen(function* () {
    const data = yield* api.applePushKeys.download({ path: { id } }).pipe(
      Effect.mapError(
        (cause) =>
          new CredentialsJsonError({
            message: `Failed to download push key: ${formatCause(cause)}`,
          }),
      ),
    );
    const rel = path.join(keysDir, `${data.id}.p8`);
    yield* writeText(fs, projectRoot, rel, data.p8Pem);
    return { rel, keyId: data.keyId, teamId: data.appleTeamIdentifier, id: data.id };
  });

const downloadAscApiKey = (
  api: ApiClient,
  fs: FileSystem.FileSystem,
  projectRoot: string,
  keysDir: string,
  id: string,
) =>
  Effect.gen(function* () {
    const data = yield* api.ascApiKeys.getCredentials({ path: { id } }).pipe(
      Effect.mapError(
        (cause) =>
          new CredentialsJsonError({
            message: `Failed to download ASC API key: ${formatCause(cause)}`,
          }),
      ),
    );
    const rel = path.join(keysDir, `${data.ascApiKeyId}-asc.p8`);
    yield* writeText(fs, projectRoot, rel, data.p8Pem);
    return { rel, keyId: data.keyId, issuerId: data.issuerId, id: data.ascApiKeyId };
  });

const pullIos = (
  api: ApiClient,
  fs: FileSystem.FileSystem,
  projectRoot: string,
  keysDir: string,
): Effect.Effect<
  { readonly entry: CredentialsJson["ios"]; readonly rows: readonly PullRow[] },
  CredentialsJsonError
> =>
  Effect.gen(function* () {
    const listing = yield* fetchIosListing(api);
    const rows: PullRow[] = [];
    const storage = new Map<
      string,
      { readonly relPath: string; readonly extras?: Record<string, string> }
    >();

    if (listing.certFirst) {
      const result = yield* downloadIosDistCert(
        api,
        fs,
        projectRoot,
        keysDir,
        listing.certFirst.id,
      );
      storage.set(listing.certFirst.id, {
        relPath: result.rel,
        extras: { password: result.password },
      });
      rows.push({ type: "ios:distribution-certificate", path: result.rel, id: result.id });
    }
    if (listing.profileFirst) {
      const result = yield* downloadProvisioningProfile(
        api,
        fs,
        projectRoot,
        keysDir,
        listing.profileFirst.id,
      );
      storage.set(listing.profileFirst.id, { relPath: result.rel });
      rows.push({ type: "ios:provisioning-profile", path: result.rel, id: result.id });
    }
    if (listing.pushFirst) {
      const result = yield* downloadIosPushKey(api, fs, projectRoot, keysDir, listing.pushFirst.id);
      storage.set(listing.pushFirst.id, {
        relPath: result.rel,
        extras: { keyId: result.keyId, teamId: result.teamId },
      });
      rows.push({ type: "ios:push-key", path: result.rel, id: result.id });
    }
    if (listing.ascFirst) {
      const result = yield* downloadAscApiKey(api, fs, projectRoot, keysDir, listing.ascFirst.id);
      storage.set(listing.ascFirst.id, {
        relPath: result.rel,
        extras: { keyId: result.keyId, issuerId: result.issuerId },
      });
      rows.push({ type: "ios:asc-api-key", path: result.rel, id: result.id });
    }

    const entry = buildIosFromMeta({
      first: listing.certFirst
        ? { id: listing.certFirst.id, label: listing.certFirst.serialNumber }
        : undefined,
      profileFirst: listing.profileFirst
        ? { id: listing.profileFirst.id, label: listing.profileFirst.bundleIdentifier }
        : undefined,
      pushFirst: listing.pushFirst
        ? { id: listing.pushFirst.id, label: listing.pushFirst.keyId }
        : undefined,
      ascFirst: listing.ascFirst
        ? { id: listing.ascFirst.id, label: listing.ascFirst.name }
        : undefined,
      storage,
    });
    return { entry, rows };
  });

const pullAndroid = (
  api: ApiClient,
  fs: FileSystem.FileSystem,
  projectRoot: string,
  keysDir: string,
): Effect.Effect<
  { readonly entry: CredentialsJson["android"]; readonly rows: readonly PullRow[] },
  CredentialsJsonError
> =>
  Effect.gen(function* () {
    const [keystores, gsaKeys] = yield* Effect.all(
      [api.androidUploadKeystores.list(), api.googleServiceAccountKeys.list()],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.mapError(
        (cause) =>
          new CredentialsJsonError({
            message: `Failed to list Android credentials: ${formatCause(cause)}`,
          }),
      ),
    );

    const rows: PullRow[] = [];
    const keystoreFirst = keystores.items.at(0);
    if (!keystoreFirst) {
      return { entry: undefined, rows: [] } as const;
    }
    const keystoreData = yield* api.androidUploadKeystores
      .download({ path: { id: keystoreFirst.id } })
      .pipe(
        Effect.mapError(
          (cause) =>
            new CredentialsJsonError({
              message: `Failed to download keystore: ${formatCause(cause)}`,
            }),
        ),
      );
    const keystoreRel = path.join(keysDir, `${keystoreData.id}.keystore`);
    yield* writeArtifact(fs, projectRoot, keystoreRel, fromBase64(keystoreData.keystoreBase64));
    rows.push({ type: "android:keystore", path: keystoreRel, id: keystoreData.id });

    const entry: NonNullable<CredentialsJson["android"]> = {
      keystore: {
        keystorePath: keystoreRel,
        keystorePassword: keystoreData.keystorePassword,
        keyAlias: keystoreData.keyAlias,
        keyPassword: keystoreData.keyPassword,
      },
    };

    const gsaFirst = gsaKeys.items.at(0);
    if (gsaFirst) {
      const gsaData = yield* api.googleServiceAccountKeys
        .download({ path: { id: gsaFirst.id } })
        .pipe(
          Effect.mapError(
            (cause) =>
              new CredentialsJsonError({
                message: `Failed to download Google service account key: ${formatCause(cause)}`,
              }),
          ),
        );
      const rel = path.join(keysDir, `${gsaData.id}-gsa.json`);
      yield* writeText(fs, projectRoot, rel, gsaData.json);
      rows.push({ type: "android:google-service-account-key", path: rel, id: gsaData.id });
      return {
        entry: { ...entry, googleServiceAccountKey: { path: rel } },
        rows,
      } as const;
    }
    return { entry, rows } as const;
  });

export const pullCommand = defineCommand({
  meta: {
    name: "pull",
    description: "Download account credentials into a local credentials.json",
  },
  args: {
    platform: {
      type: "enum",
      options: ["ios", "android", "all"],
      default: "all",
      description: "Limit to a single platform",
    },
    "keys-dir": {
      type: "string",
      default: "credentials",
      description: "Directory (relative to project root) for downloaded key files",
    },
    "skip-gitignore": {
      type: "boolean",
      description: "Skip auto-appending credentials.json/keys-dir to .gitignore",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const runtime = yield* CliRuntime;
        const projectRoot = yield* runtime.cwd;
        const fs = yield* FileSystem.FileSystem;

        const includeIos = args.platform === "all" || args.platform === "ios";
        const includeAndroid = args.platform === "all" || args.platform === "android";

        const iosResult = includeIos
          ? yield* pullIos(api, fs, projectRoot, args["keys-dir"])
          : { entry: undefined, rows: [] as readonly PullRow[] };
        const androidResult = includeAndroid
          ? yield* pullAndroid(api, fs, projectRoot, args["keys-dir"])
          : { entry: undefined, rows: [] as readonly PullRow[] };

        const allRows = [...iosResult.rows, ...androidResult.rows];
        if (allRows.length === 0) {
          yield* Console.log(`No ${args.platform} credentials available to pull.`);
          return;
        }

        const next: CredentialsJson = {
          ...(iosResult.entry === undefined ? {} : { ios: iosResult.entry }),
          ...(androidResult.entry === undefined ? {} : { android: androidResult.entry }),
        };
        const outPath = yield* writeCredentialsJson(projectRoot, next);

        if (!args["skip-gitignore"]) {
          const added = yield* ensureGitignoreEntries(fs, projectRoot, [
            "credentials.json",
            `${args["keys-dir"]}/`,
          ]);
          if (added.length > 0) {
            yield* printHuman(`Added to .gitignore: ${added.join(", ")}`);
          }
        }

        yield* printTable(
          ["Type", "Path", "ID"],
          allRows.map((row) => [row.type, row.path, row.id]),
        );
        yield* Console.log("");
        yield* Console.log(`credentials.json written to ${outPath}`);
      }),
      SYNC_EXIT_EXTRAS,
    ),
});
