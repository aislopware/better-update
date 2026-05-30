import path from "node:path";

import { fromBase64 } from "@better-update/encoding";
import { compact } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  openFromDownload,
  openVaultSessionInteractive,
} from "../../../application/credential-cipher";
import { runEffect } from "../../../lib/citty-effect";
import { requireSecretString } from "../../../lib/credential-secret";
import { writeCredentialsJson } from "../../../lib/credentials-json";
import { CredentialsJsonError } from "../../../lib/exit-codes";
import { formatCause } from "../../../lib/format-error";
import { printHuman, printHumanTable } from "../../../lib/output";
import { apiClient } from "../../../services/api-client";
import { CliRuntime } from "../../../services/cli-runtime";
import {
  buildIosFromMeta,
  ensureGitignoreEntries,
  SYNC_EXIT_EXTRAS,
  writeArtifact,
  writeText,
} from "./helpers";

import type { VaultSession } from "../../../application/credential-cipher";
import type { CredentialsJson } from "../../../lib/credentials-json";
import type { ApiClient } from "../../../services/api-client";
import type { IdentityStore } from "../../../services/identity-store";
import type { PullRow } from "./helpers";

/** Decrypt a download envelope's secret, surfacing failures as CredentialsJsonError. */
const decryptSecret = (args: {
  readonly session: VaultSession;
  readonly credentialType: string;
  readonly downloaded: Parameters<typeof openFromDownload>[0]["downloaded"];
  readonly label: string;
}) =>
  openFromDownload({
    session: args.session,
    credentialType: args.credentialType,
    downloaded: args.downloaded,
  }).pipe(
    Effect.mapError(
      (cause) =>
        new CredentialsJsonError({
          message: `Failed to decrypt ${args.label}: ${formatCause(cause)}`,
        }),
    ),
  );

/** Read a required string field from a decrypted secret. */
const secretField = (secret: Record<string, unknown>, key: string, label: string) =>
  requireSecretString(
    secret,
    key,
    (field) => new CredentialsJsonError({ message: `Decrypted ${label} is missing "${field}".` }),
  );

/** Shared inputs for each per-credential pull/download helper. */
interface PullCtx {
  readonly api: ApiClient;
  readonly fs: FileSystem.FileSystem;
  readonly projectRoot: string;
  readonly keysDir: string;
  readonly session: VaultSession;
}

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

const downloadIosDistCert = (ctx: PullCtx, id: string) =>
  Effect.gen(function* () {
    const data = yield* ctx.api.appleDistributionCertificates.download({ path: { id } }).pipe(
      Effect.mapError(
        (cause) =>
          new CredentialsJsonError({
            message: `Failed to download distribution certificate: ${formatCause(cause)}`,
          }),
      ),
    );
    const secret = yield* decryptSecret({
      session: ctx.session,
      credentialType: "distribution-certificate",
      downloaded: data,
      label: "distribution certificate",
    });
    const p12Base64 = yield* secretField(secret, "p12Base64", "distribution certificate");
    const password = yield* secretField(secret, "p12Password", "distribution certificate");
    const rel = path.join(ctx.keysDir, `${data.id}.p12`);
    yield* writeArtifact(ctx.fs, ctx.projectRoot, rel, fromBase64(p12Base64));
    return { rel, password, id: data.id };
  });

const downloadProvisioningProfile = (ctx: PullCtx, id: string) =>
  Effect.gen(function* () {
    const data = yield* ctx.api.appleProvisioningProfiles.download({ path: { id } }).pipe(
      Effect.mapError(
        (cause) =>
          new CredentialsJsonError({
            message: `Failed to download provisioning profile: ${formatCause(cause)}`,
          }),
      ),
    );
    const rel = path.join(ctx.keysDir, `${data.id}.mobileprovision`);
    yield* writeArtifact(ctx.fs, ctx.projectRoot, rel, fromBase64(data.profileBase64));
    return { rel, id: data.id };
  });

const downloadIosPushKey = (ctx: PullCtx, id: string) =>
  Effect.gen(function* () {
    const data = yield* ctx.api.applePushKeys.download({ path: { id } }).pipe(
      Effect.mapError(
        (cause) =>
          new CredentialsJsonError({
            message: `Failed to download push key: ${formatCause(cause)}`,
          }),
      ),
    );
    const secret = yield* decryptSecret({
      session: ctx.session,
      credentialType: "push-key",
      downloaded: data,
      label: "push key",
    });
    const p8Pem = yield* secretField(secret, "p8Pem", "push key");
    const rel = path.join(ctx.keysDir, `${data.id}.p8`);
    yield* writeText(ctx.fs, ctx.projectRoot, rel, p8Pem);
    return { rel, keyId: data.keyId, teamId: data.appleTeamIdentifier, id: data.id };
  });

const downloadAscApiKey = (ctx: PullCtx, id: string) =>
  Effect.gen(function* () {
    const data = yield* ctx.api.ascApiKeys.getCredentials({ path: { id } }).pipe(
      Effect.mapError(
        (cause) =>
          new CredentialsJsonError({
            message: `Failed to download ASC API key: ${formatCause(cause)}`,
          }),
      ),
    );
    const secret = yield* decryptSecret({
      session: ctx.session,
      credentialType: "asc-api-key",
      // `getCredentials` keys the row id as `ascApiKeyId`; the cipher binds on `id`.
      downloaded: {
        id: data.ascApiKeyId,
        ciphertext: data.ciphertext,
        wrappedDek: data.wrappedDek,
        vaultVersion: data.vaultVersion,
        keyId: data.keyId,
        issuerId: data.issuerId,
      },
      label: "ASC API key",
    });
    const p8Pem = yield* secretField(secret, "p8Pem", "ASC API key");
    const rel = path.join(ctx.keysDir, `${data.ascApiKeyId}-asc.p8`);
    yield* writeText(ctx.fs, ctx.projectRoot, rel, p8Pem);
    return { rel, keyId: data.keyId, issuerId: data.issuerId, id: data.ascApiKeyId };
  });

const pullIos = (
  ctx: PullCtx,
): Effect.Effect<
  { readonly entry: CredentialsJson["ios"]; readonly rows: readonly PullRow[] },
  CredentialsJsonError,
  CliRuntime | IdentityStore
> =>
  Effect.gen(function* () {
    const listing = yield* fetchIosListing(ctx.api);
    const rows: PullRow[] = [];
    const storage = new Map<
      string,
      { readonly relPath: string; readonly extras?: Record<string, string> }
    >();

    if (listing.certFirst) {
      const result = yield* downloadIosDistCert(ctx, listing.certFirst.id);
      storage.set(listing.certFirst.id, {
        relPath: result.rel,
        extras: { password: result.password },
      });
      rows.push({ type: "ios:distribution-certificate", path: result.rel, id: result.id });
    }
    if (listing.profileFirst) {
      const result = yield* downloadProvisioningProfile(ctx, listing.profileFirst.id);
      storage.set(listing.profileFirst.id, { relPath: result.rel });
      rows.push({ type: "ios:provisioning-profile", path: result.rel, id: result.id });
    }
    if (listing.pushFirst) {
      const result = yield* downloadIosPushKey(ctx, listing.pushFirst.id);
      storage.set(listing.pushFirst.id, {
        relPath: result.rel,
        extras: { keyId: result.keyId, teamId: result.teamId },
      });
      rows.push({ type: "ios:push-key", path: result.rel, id: result.id });
    }
    if (listing.ascFirst) {
      const result = yield* downloadAscApiKey(ctx, listing.ascFirst.id);
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
  ctx: PullCtx,
): Effect.Effect<
  { readonly entry: CredentialsJson["android"]; readonly rows: readonly PullRow[] },
  CredentialsJsonError,
  CliRuntime | IdentityStore
> =>
  Effect.gen(function* () {
    const [keystores, gsaKeys] = yield* Effect.all(
      [ctx.api.androidUploadKeystores.list(), ctx.api.googleServiceAccountKeys.list()],
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
    const keystoreData = yield* ctx.api.androidUploadKeystores
      .download({ path: { id: keystoreFirst.id } })
      .pipe(
        Effect.mapError(
          (cause) =>
            new CredentialsJsonError({
              message: `Failed to download keystore: ${formatCause(cause)}`,
            }),
        ),
      );
    const keystoreSecret = yield* decryptSecret({
      session: ctx.session,
      credentialType: "keystore",
      downloaded: keystoreData,
      label: "keystore",
    });
    const keystoreBase64 = yield* secretField(keystoreSecret, "keystoreBase64", "keystore");
    const keystorePassword = yield* secretField(keystoreSecret, "keystorePassword", "keystore");
    const keyPassword = yield* secretField(keystoreSecret, "keyPassword", "keystore");
    const keystoreRel = path.join(ctx.keysDir, `${keystoreData.id}.keystore`);
    yield* writeArtifact(ctx.fs, ctx.projectRoot, keystoreRel, fromBase64(keystoreBase64));
    rows.push({ type: "android:keystore", path: keystoreRel, id: keystoreData.id });

    const entry: NonNullable<CredentialsJson["android"]> = {
      keystore: {
        keystorePath: keystoreRel,
        keystorePassword,
        keyAlias: keystoreData.keyAlias,
        keyPassword,
      },
    };

    const gsaFirst = gsaKeys.items.at(0);
    if (gsaFirst) {
      const gsaData = yield* ctx.api.googleServiceAccountKeys
        .download({ path: { id: gsaFirst.id } })
        .pipe(
          Effect.mapError(
            (cause) =>
              new CredentialsJsonError({
                message: `Failed to download Google service account key: ${formatCause(cause)}`,
              }),
          ),
        );
      const gsaSecret = yield* decryptSecret({
        session: ctx.session,
        credentialType: "google-service-account-key",
        downloaded: gsaData,
        label: "Google service account key",
      });
      const json = yield* secretField(gsaSecret, "json", "Google service account key");
      const rel = path.join(ctx.keysDir, `${gsaData.id}-gsa.json`);
      yield* writeText(ctx.fs, ctx.projectRoot, rel, json);
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
        const session = yield* openVaultSessionInteractive(api);
        const ctx: PullCtx = { api, fs, projectRoot, keysDir: args["keys-dir"], session };

        const includeIos = args.platform === "all" || args.platform === "ios";
        const includeAndroid = args.platform === "all" || args.platform === "android";

        const iosResult = includeIos
          ? yield* pullIos(ctx)
          : { entry: undefined, rows: [] as readonly PullRow[] };
        const androidResult = includeAndroid
          ? yield* pullAndroid(ctx)
          : { entry: undefined, rows: [] as readonly PullRow[] };

        const allRows = [...iosResult.rows, ...androidResult.rows];
        if (allRows.length === 0) {
          yield* printHuman(`No ${args.platform} credentials available to pull.`);
          return { pulled: 0, items: [] as readonly PullRow[] };
        }

        const next: CredentialsJson = compact({
          ios: iosResult.entry,
          android: androidResult.entry,
        });
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

        yield* printHumanTable(
          ["Type", "Path", "ID"],
          allRows.map((row) => [row.type, row.path, row.id]),
        );
        yield* printHuman("");
        yield* printHuman(`credentials.json written to ${outPath}`);
        return { pulled: allRows.length, path: outPath, items: allRows };
      }),
      { exits: SYNC_EXIT_EXTRAS, json: "value" },
    ),
});
