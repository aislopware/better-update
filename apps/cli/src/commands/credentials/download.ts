import path from "node:path";

import { fromBase64 } from "@better-update/encoding";
import { FileSystem } from "@effect/platform";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { CredentialValidationError } from "../../lib/exit-codes";
import { printJson, printKeyValue } from "../../lib/output";
import { OutputMode } from "../../lib/output-mode";
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

const downloadDistributionCertificate = (
  api: ApiClient,
  id: string,
  cwd: string,
  output: string | undefined,
) =>
  Effect.gen(function* () {
    const data = yield* api.appleDistributionCertificates.download({ path: { id } });
    const filePath = resolveOutputPath(cwd, output, `${data.id}.p12`);
    yield* writeBinary(filePath, fromBase64(data.p12Base64));
    return {
      path: filePath,
      pairs: [
        ["Path", filePath],
        ["Type", "Apple distribution certificate (.p12)"],
        ["Serial", data.serialNumber],
        ["Apple team", data.appleTeamIdentifier],
        ["Valid from", data.validFrom],
        ["Valid until", data.validUntil],
        ["P12 password", data.p12Password],
      ] as const,
      metadata: {
        serialNumber: data.serialNumber,
        appleTeamIdentifier: data.appleTeamIdentifier,
        validFrom: data.validFrom,
        validUntil: data.validUntil,
        p12Password: data.p12Password,
      },
    } satisfies DownloadResult;
  });

const downloadProvisioningProfile = (
  api: ApiClient,
  id: string,
  cwd: string,
  output: string | undefined,
) =>
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
        ...(data.profileName === null ? {} : { profileName: data.profileName }),
        ...(data.developerPortalIdentifier === null
          ? {}
          : { developerPortalIdentifier: data.developerPortalIdentifier }),
      },
    } satisfies DownloadResult;
  });

const downloadPushKey = (api: ApiClient, id: string, cwd: string, output: string | undefined) =>
  Effect.gen(function* () {
    const data = yield* api.applePushKeys.download({ path: { id } });
    const filePath = resolveOutputPath(cwd, output, `AuthKey_${data.keyId}.p8`);
    yield* writeText(filePath, data.p8Pem);
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

const downloadAscApiKey = (api: ApiClient, id: string, cwd: string, output: string | undefined) =>
  Effect.gen(function* () {
    const data = yield* api.ascApiKeys.getCredentials({ path: { id } });
    const filePath = resolveOutputPath(cwd, output, `AuthKey_${data.keyId}-asc.p8`);
    yield* writeText(filePath, data.p8Pem);
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
        ...(data.appleTeamIdentifier === null
          ? {}
          : { appleTeamIdentifier: data.appleTeamIdentifier }),
      },
    } satisfies DownloadResult;
  });

const downloadKeystore = (api: ApiClient, id: string, cwd: string, output: string | undefined) =>
  Effect.gen(function* () {
    const data = yield* api.androidUploadKeystores.download({ path: { id } });
    const filePath = resolveOutputPath(cwd, output, `${data.id}.keystore`);
    yield* writeBinary(filePath, fromBase64(data.keystoreBase64));
    return {
      path: filePath,
      pairs: [
        ["Path", filePath],
        ["Type", "Android upload keystore"],
        ["Key alias", data.keyAlias],
        ["Keystore password", data.keystorePassword],
        ["Key password", data.keyPassword],
      ] as const,
      metadata: {
        keyAlias: data.keyAlias,
        keystorePassword: data.keystorePassword,
        keyPassword: data.keyPassword,
      },
    } satisfies DownloadResult;
  });

const downloadGoogleServiceAccountKey = (
  api: ApiClient,
  id: string,
  cwd: string,
  output: string | undefined,
) =>
  Effect.gen(function* () {
    const data = yield* api.googleServiceAccountKeys.download({ path: { id } });
    const filePath = resolveOutputPath(cwd, output, `${data.id}-gsa.json`);
    yield* writeText(filePath, data.json);
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

const dispatchDownload = (
  api: ApiClient,
  type: DownloadType,
  id: string,
  cwd: string,
  output: string | undefined,
) => {
  switch (type) {
    case "distribution-certificate": {
      return downloadDistributionCertificate(api, id, cwd, output);
    }
    case "provisioning-profile": {
      return downloadProvisioningProfile(api, id, cwd, output);
    }
    case "push-key": {
      return downloadPushKey(api, id, cwd, output);
    }
    case "asc-api-key": {
      return downloadAscApiKey(api, id, cwd, output);
    }
    case "keystore": {
      return downloadKeystore(api, id, cwd, output);
    }
    case "google-service-account-key": {
      return downloadGoogleServiceAccountKey(api, id, cwd, output);
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
        const result = yield* dispatchDownload(api, args.type, args.id, cwd, args.output);
        const mode = yield* OutputMode;
        if (mode.json) {
          yield* printJson({ path: result.path, ...result.metadata });
          return undefined;
        }
        yield* printKeyValue(result.pairs.map((pair) => [pair[0], pair[1]] as const));
        return undefined;
      }),
    ),
});
