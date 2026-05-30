import path from "node:path";

import { fromBase64 } from "@better-update/encoding";
import { compact, toOptional } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { openFromDownload, openVaultSessionInteractive } from "../../application/credential-cipher";
import { runEffect } from "../../lib/citty-effect";
import { requireSecretString } from "../../lib/credential-secret";
import { CredentialValidationError, IdentityError } from "../../lib/exit-codes";
import { printHumanKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";

import type { ApiClient } from "../../services/api-client";

const DOWNLOAD_TYPES = [
  "distribution-certificate",
  "provisioning-profile",
  "push-key",
  "asc-api-key",
  "keystore",
  "google-service-account-key",
] as const;

type DownloadType = (typeof DOWNLOAD_TYPES)[number];

interface DownloadResult {
  readonly path: string;
  readonly pairs: readonly (readonly [string, string])[];
  readonly metadata: Readonly<Record<string, string>>;
}

const writeBinary = (filePath: string, bytes: Uint8Array) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFile(filePath, bytes);
  });

const writeText = (filePath: string, contents: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(filePath, contents);
  });

const resolveOutputPath = (cwd: string, output: string | undefined, defaultName: string) =>
  output === undefined || output.length === 0 ? path.join(cwd, defaultName) : output;

/** Shared inputs for every per-type download handler. */
interface DownloadCtx {
  readonly api: ApiClient;
  readonly id: string;
  readonly cwd: string;
  readonly output: string | undefined;
}

/** Read a required string field out of a decrypted secret, failing if absent. */
const secretString = (secret: Record<string, unknown>, key: string) =>
  requireSecretString(
    secret,
    key,
    (field) =>
      new IdentityError({ message: `Decrypted credential is missing the "${field}" field.` }),
  );

const downloadDistributionCertificate = ({ api, id, cwd, output }: DownloadCtx) =>
  Effect.gen(function* () {
    const data = yield* api.appleDistributionCertificates.download({ path: { id } });
    const session = yield* openVaultSessionInteractive(api);
    const secret = yield* openFromDownload({
      session,
      credentialType: "distribution-certificate",
      downloaded: data,
    });
    const p12Base64 = yield* secretString(secret, "p12Base64");
    const p12Password = yield* secretString(secret, "p12Password");
    const filePath = resolveOutputPath(cwd, output, `${data.id}.p12`);
    yield* writeBinary(filePath, fromBase64(p12Base64));
    return {
      path: filePath,
      pairs: [
        ["Path", filePath],
        ["Type", "Apple distribution certificate (.p12)"],
        ["Serial", data.serialNumber],
        ["Apple team", data.appleTeamIdentifier],
        ["Valid from", data.validFrom],
        ["Valid until", data.validUntil],
        ["P12 password", p12Password],
      ] as const,
      metadata: {
        serialNumber: data.serialNumber,
        appleTeamIdentifier: data.appleTeamIdentifier,
        validFrom: data.validFrom,
        validUntil: data.validUntil,
        p12Password,
      },
    } satisfies DownloadResult;
  });

const downloadProvisioningProfile = ({ api, id, cwd, output }: DownloadCtx) =>
  Effect.gen(function* () {
    const data = yield* api.appleProvisioningProfiles.download({ path: { id } });
    const filePath = resolveOutputPath(cwd, output, `${data.id}.mobileprovision`);
    yield* writeBinary(filePath, fromBase64(data.profileBase64));
    return {
      path: filePath,
      pairs: [
        ["Path", filePath],
        ["Type", "Apple provisioning profile (.mobileprovision)"],
        ["Bundle", data.bundleIdentifier],
        ["Distribution", data.distributionType],
        ["Profile name", data.profileName ?? "-"],
        ["Apple profile", data.developerPortalIdentifier ?? "-"],
      ] as const,
      metadata: {
        bundleIdentifier: data.bundleIdentifier,
        distributionType: data.distributionType,
        ...compact({
          profileName: toOptional(data.profileName),
          developerPortalIdentifier: toOptional(data.developerPortalIdentifier),
        }),
      },
    } satisfies DownloadResult;
  });

const downloadPushKey = ({ api, id, cwd, output }: DownloadCtx) =>
  Effect.gen(function* () {
    const data = yield* api.applePushKeys.download({ path: { id } });
    const session = yield* openVaultSessionInteractive(api);
    const secret = yield* openFromDownload({
      session,
      credentialType: "push-key",
      downloaded: data,
    });
    const p8Pem = yield* secretString(secret, "p8Pem");
    const filePath = resolveOutputPath(cwd, output, `AuthKey_${data.keyId}.p8`);
    yield* writeText(filePath, p8Pem);
    return {
      path: filePath,
      pairs: [
        ["Path", filePath],
        ["Type", "Apple APNs auth key (.p8)"],
        ["Key ID", data.keyId],
        ["Apple team", data.appleTeamIdentifier],
      ] as const,
      metadata: {
        keyId: data.keyId,
        appleTeamIdentifier: data.appleTeamIdentifier,
      },
    } satisfies DownloadResult;
  });

const downloadAscApiKey = ({ api, id, cwd, output }: DownloadCtx) =>
  Effect.gen(function* () {
    const data = yield* api.ascApiKeys.getCredentials({ path: { id } });
    const session = yield* openVaultSessionInteractive(api);
    const secret = yield* openFromDownload({
      session,
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
    });
    const p8Pem = yield* secretString(secret, "p8Pem");
    const filePath = resolveOutputPath(cwd, output, `AuthKey_${data.keyId}-asc.p8`);
    yield* writeText(filePath, p8Pem);
    return {
      path: filePath,
      pairs: [
        ["Path", filePath],
        ["Type", "App Store Connect API key (.p8)"],
        ["Key ID", data.keyId],
        ["Issuer ID", data.issuerId],
        ["Apple team", data.appleTeamIdentifier ?? "-"],
      ] as const,
      metadata: {
        keyId: data.keyId,
        issuerId: data.issuerId,
        ...compact({ appleTeamIdentifier: toOptional(data.appleTeamIdentifier) }),
      },
    } satisfies DownloadResult;
  });

const downloadKeystore = ({ api, id, cwd, output }: DownloadCtx) =>
  Effect.gen(function* () {
    const data = yield* api.androidUploadKeystores.download({ path: { id } });
    const session = yield* openVaultSessionInteractive(api);
    const secret = yield* openFromDownload({
      session,
      credentialType: "keystore",
      downloaded: data,
    });
    const keystoreBase64 = yield* secretString(secret, "keystoreBase64");
    const keystorePassword = yield* secretString(secret, "keystorePassword");
    const keyPassword = yield* secretString(secret, "keyPassword");
    const filePath = resolveOutputPath(cwd, output, `${data.id}.keystore`);
    yield* writeBinary(filePath, fromBase64(keystoreBase64));
    return {
      path: filePath,
      pairs: [
        ["Path", filePath],
        ["Type", "Android upload keystore"],
        ["Key alias", data.keyAlias],
        ["Keystore password", keystorePassword],
        ["Key password", keyPassword],
      ] as const,
      metadata: {
        keyAlias: data.keyAlias,
        keystorePassword,
        keyPassword,
      },
    } satisfies DownloadResult;
  });

const downloadGoogleServiceAccountKey = ({ api, id, cwd, output }: DownloadCtx) =>
  Effect.gen(function* () {
    const data = yield* api.googleServiceAccountKeys.download({ path: { id } });
    const session = yield* openVaultSessionInteractive(api);
    const secret = yield* openFromDownload({
      session,
      credentialType: "google-service-account-key",
      downloaded: data,
    });
    const json = yield* secretString(secret, "json");
    const filePath = resolveOutputPath(cwd, output, `${data.id}-gsa.json`);
    yield* writeText(filePath, json);
    return {
      path: filePath,
      pairs: [
        ["Path", filePath],
        ["Type", "Google service account key (.json)"],
        ["Client email", data.clientEmail],
      ] as const,
      metadata: {
        clientEmail: data.clientEmail,
      },
    } satisfies DownloadResult;
  });

const dispatchDownload = (ctx: DownloadCtx, type: DownloadType) => {
  switch (type) {
    case "distribution-certificate": {
      return downloadDistributionCertificate(ctx);
    }
    case "provisioning-profile": {
      return downloadProvisioningProfile(ctx);
    }
    case "push-key": {
      return downloadPushKey(ctx);
    }
    case "asc-api-key": {
      return downloadAscApiKey(ctx);
    }
    case "keystore": {
      return downloadKeystore(ctx);
    }
    case "google-service-account-key": {
      return downloadGoogleServiceAccountKey(ctx);
    }
    default: {
      return Effect.fail(
        new CredentialValidationError({
          message: `Unsupported credential type: ${String(type)}`,
        }),
      );
    }
  }
};

export const downloadCommand = defineCommand({
  meta: {
    name: "download",
    description:
      "Download a single credential file (keystore/.p12/.mobileprovision/.p8/.json) for local use",
  },
  args: {
    id: { type: "positional", required: true, description: "Credential ID" },
    type: {
      type: "enum",
      options: [...DOWNLOAD_TYPES],
      required: true,
      description: "Credential type",
    },
    output: {
      type: "string",
      description: "Output path (default: ./<id>.<ext> derived from credential type)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const runtime = yield* CliRuntime;
        const cwd = yield* runtime.cwd;
        const result = yield* dispatchDownload(
          { api, id: args.id, cwd, output: args.output },
          args.type,
        );
        yield* printHumanKeyValue(result.pairs.map((pair) => [pair[0], pair[1]] as const));
        return { path: result.path, ...result.metadata };
      }),
      { json: "value" },
    ),
});
