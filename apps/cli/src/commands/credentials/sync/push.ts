import { defineCommand } from "citty";
import { Effect } from "effect";

import type { FileSystem } from "@effect/platform";

import { runEffect } from "../../../lib/citty-effect";
import { readCredentialsJson, resolveCredentialPath } from "../../../lib/credentials-json";
import { uploadCredential } from "../../../lib/credentials-manager";
import { CredentialsJsonError } from "../../../lib/exit-codes";
import { formatCause } from "../../../lib/format-error";
import { printHuman, printHumanTable } from "../../../lib/output";
import { apiClient } from "../../../services/api-client";
import { CliRuntime } from "../../../services/cli-runtime";
import { SYNC_EXIT_EXTRAS } from "./helpers";

import type { CredentialsJson } from "../../../lib/credentials-json";
import type { InteractiveMode } from "../../../lib/interactive-mode";
import type { ApiClient } from "../../../services/api-client";
import type { IdentityStore } from "../../../services/identity-store";
import type { SyncRow } from "./helpers";

/** Services the credential-sealing upload path pulls in beyond the filesystem. */
type PushRequirements = FileSystem.FileSystem | CliRuntime | IdentityStore | InteractiveMode;

const pushIos = (
  api: ApiClient,
  projectRoot: string,
  ios: NonNullable<CredentialsJson["ios"]>,
): Effect.Effect<readonly SyncRow[], CredentialsJsonError, PushRequirements> =>
  Effect.gen(function* () {
    const rows: SyncRow[] = [];

    const distResult = yield* uploadCredential(api, {
      platform: "ios",
      type: "distribution-certificate",
      name: "credentials.json: distribution certificate",
      filePath: resolveCredentialPath(projectRoot, ios.distributionCertificate.path),
      password: ios.distributionCertificate.password,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new CredentialsJsonError({
            message: `Failed to upload iOS distribution certificate: ${formatCause(cause)}`,
          }),
      ),
    );
    rows.push({
      type: "ios:distribution-certificate",
      path: ios.distributionCertificate.path,
      status: "uploaded",
      id: distResult.id,
    });

    const profileResult = yield* uploadCredential(api, {
      platform: "ios",
      type: "provisioning-profile",
      name: "credentials.json: provisioning profile",
      filePath: resolveCredentialPath(projectRoot, ios.provisioningProfilePath),
    }).pipe(
      Effect.mapError(
        (cause) =>
          new CredentialsJsonError({
            message: `Failed to upload iOS provisioning profile: ${formatCause(cause)}`,
          }),
      ),
    );
    rows.push({
      type: "ios:provisioning-profile",
      path: ios.provisioningProfilePath,
      status: "uploaded",
      id: profileResult.id,
    });

    if (ios.pushKey) {
      const pushResult = yield* uploadCredential(api, {
        platform: "ios",
        type: "push-key",
        name: "credentials.json: push key",
        filePath: resolveCredentialPath(projectRoot, ios.pushKey.path),
        keyId: ios.pushKey.keyId,
        appleTeamIdentifier: ios.pushKey.teamId,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new CredentialsJsonError({
              message: `Failed to upload iOS push key: ${formatCause(cause)}`,
            }),
        ),
      );
      rows.push({
        type: "ios:push-key",
        path: ios.pushKey.path,
        status: "uploaded",
        id: pushResult.id,
      });
    }

    if (ios.ascApiKey) {
      const ascResult = yield* uploadCredential(api, {
        platform: "ios",
        type: "asc-api-key",
        name: "credentials.json: asc api key",
        filePath: resolveCredentialPath(projectRoot, ios.ascApiKey.path),
        keyId: ios.ascApiKey.keyId,
        issuerId: ios.ascApiKey.issuerId,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new CredentialsJsonError({
              message: `Failed to upload iOS ASC API key: ${formatCause(cause)}`,
            }),
        ),
      );
      rows.push({
        type: "ios:asc-api-key",
        path: ios.ascApiKey.path,
        status: "uploaded",
        id: ascResult.id,
      });
    }

    return rows;
  });

const pushAndroid = (
  api: ApiClient,
  projectRoot: string,
  android: NonNullable<CredentialsJson["android"]>,
): Effect.Effect<readonly SyncRow[], CredentialsJsonError, PushRequirements> =>
  Effect.gen(function* () {
    const rows: SyncRow[] = [];

    const keystoreResult = yield* uploadCredential(api, {
      platform: "android",
      type: "keystore",
      name: "credentials.json: keystore",
      filePath: resolveCredentialPath(projectRoot, android.keystore.keystorePath),
      password: android.keystore.keystorePassword,
      keyAlias: android.keystore.keyAlias,
      keyPassword: android.keystore.keyPassword,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new CredentialsJsonError({
            message: `Failed to upload Android keystore: ${formatCause(cause)}`,
          }),
      ),
    );
    rows.push({
      type: "android:keystore",
      path: android.keystore.keystorePath,
      status: "uploaded",
      id: keystoreResult.id,
    });

    if (android.googleServiceAccountKey) {
      const gsaResult = yield* uploadCredential(api, {
        platform: "android",
        type: "google-service-account-key",
        name: "credentials.json: google service account",
        filePath: resolveCredentialPath(projectRoot, android.googleServiceAccountKey.path),
      }).pipe(
        Effect.mapError(
          (cause) =>
            new CredentialsJsonError({
              message: `Failed to upload Google Service Account key: ${formatCause(cause)}`,
            }),
        ),
      );
      rows.push({
        type: "android:google-service-account-key",
        path: android.googleServiceAccountKey.path,
        status: "uploaded",
        id: gsaResult.id,
      });
    }

    return rows;
  });

export const pushCommand = defineCommand({
  meta: {
    name: "push",
    description: "Upload credentials.json contents to the better-update server",
  },
  args: {
    platform: {
      type: "enum",
      options: ["ios", "android", "all"],
      default: "all",
      description: "Limit to a single platform",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const runtime = yield* CliRuntime;
        const projectRoot = yield* runtime.cwd;
        const data = yield* readCredentialsJson(projectRoot);

        const rows: SyncRow[] = [];
        if ((args.platform === "all" || args.platform === "ios") && data.ios) {
          rows.push(...(yield* pushIos(api, projectRoot, data.ios)));
        }
        if ((args.platform === "all" || args.platform === "android") && data.android) {
          rows.push(...(yield* pushAndroid(api, projectRoot, data.android)));
        }

        if (rows.length === 0) {
          yield* printHuman(`No ${args.platform} entries found in credentials.json.`);
          return { pushed: 0, items: [] as readonly SyncRow[] };
        }
        yield* printHumanTable(
          ["Type", "Path", "Status", "ID"],
          rows.map((row) => [row.type, row.path, row.status, row.id]),
        );
        return { pushed: rows.length, items: rows };
      }),
      { exits: SYNC_EXIT_EXTRAS, json: "value" },
    ),
});
