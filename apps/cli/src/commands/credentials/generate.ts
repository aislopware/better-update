import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import {
  CertificateLimitError,
  generateAndUploadDistributionCertificate,
  generateAndUploadKeystore,
  generateAndUploadProvisioningProfile,
  listAppleCertificates,
  revokeAppleCertificate,
} from "../../lib/credentials-generator";
import { CredentialValidationError } from "../../lib/exit-codes";
import { printKeyValue } from "../../lib/output";
import { promptMultiSelect, promptPassword, promptText } from "../../lib/prompts";
import { apiClient } from "../../services/api-client";

import type { ApiClient } from "../../services/api-client";

const GENERATE_EXIT_EXTRAS = {
  CredentialValidationError: 2,
  BuildFailedError: 6,
  GenerateFailedError: 6,
  CertificateLimitError: 6,
} as const;

const ensureNonEmpty = (value: string | undefined, label: string) =>
  value === undefined || value.trim().length === 0
    ? Effect.fail(new CredentialValidationError({ message: `Missing --${label}` }))
    : Effect.succeed(value);

interface KeystoreCliArgs {
  readonly alias?: string | undefined;
  readonly "store-password"?: string | undefined;
  readonly "key-password"?: string | undefined;
  readonly "common-name"?: string | undefined;
  readonly organization?: string | undefined;
  readonly "validity-days"?: string | undefined;
}

const parseValidityDays = (raw: string | undefined) => {
  if (raw === undefined || raw.length === 0) {
    return Effect.succeed(undefined);
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return Effect.fail(
      new CredentialValidationError({ message: "--validity-days must be a positive integer" }),
    );
  }
  return Effect.succeed(parsed);
};

const resolveKeystoreInput = (args: KeystoreCliArgs) =>
  Effect.gen(function* () {
    const alias =
      args.alias !== undefined && args.alias.trim().length > 0
        ? args.alias
        : yield* promptText("Key alias", { placeholder: "upload-key" });
    const storePassword =
      args["store-password"] !== undefined && args["store-password"].length > 0
        ? args["store-password"]
        : yield* promptPassword("Keystore password");
    const keyPassword =
      args["key-password"] !== undefined && args["key-password"].length > 0
        ? args["key-password"]
        : yield* promptPassword("Key password");
    const commonName =
      args["common-name"] !== undefined && args["common-name"].trim().length > 0
        ? args["common-name"]
        : yield* promptText("Common name (CN)", { placeholder: "Your App" });
    const organization =
      args.organization !== undefined && args.organization.trim().length > 0
        ? args.organization
        : yield* promptText("Organization (O)", { placeholder: "Your Company" });
    const validityDays = yield* parseValidityDays(args["validity-days"]);
    return {
      alias: yield* ensureNonEmpty(alias, "alias"),
      storePassword: yield* ensureNonEmpty(storePassword, "store-password"),
      keyPassword: yield* ensureNonEmpty(keyPassword, "key-password"),
      commonName: yield* ensureNonEmpty(commonName, "common-name"),
      organization: yield* ensureNonEmpty(organization, "organization"),
      ...(validityDays === undefined ? {} : { validityDays }),
    };
  });

const keystoreCommand = defineCommand({
  meta: {
    name: "keystore",
    description: "Generate a new Android upload keystore via keytool and store it server-side",
  },
  args: {
    alias: { type: "string", description: "Key alias" },
    "store-password": { type: "string", description: "Keystore password" },
    "key-password": { type: "string", description: "Key password" },
    "common-name": { type: "string", description: "Certificate CN" },
    organization: { type: "string", description: "Certificate O" },
    "validity-days": {
      type: "string",
      description: "Certificate validity in days (default 10000)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const resolved = yield* resolveKeystoreInput(args);
        yield* Console.log("Generating keystore with keytool...");
        const created = yield* generateAndUploadKeystore(api, {
          keyAlias: resolved.alias,
          storePassword: resolved.storePassword,
          keyPassword: resolved.keyPassword,
          commonName: resolved.commonName,
          organization: resolved.organization,
          ...(resolved.validityDays === undefined ? {} : { validityDays: resolved.validityDays }),
        });
        yield* Console.log("");
        yield* Console.log("Keystore generated and uploaded.");
        yield* printKeyValue([
          ["ID", created.id],
          ["Alias", created.keyAlias],
        ]);
      }),
      GENERATE_EXIT_EXTRAS,
    ),
});

const distributionCertificateCommand = defineCommand({
  meta: {
    name: "distribution-certificate",
    description:
      "Generate an iOS distribution certificate via the App Store Connect API and store the resulting .p12",
  },
  args: {
    "asc-key-id": {
      type: "string",
      required: true,
      description: "ASC API key ID (from `credentials list`)",
    },
    type: {
      type: "enum",
      options: ["distribution", "development"],
      default: "distribution",
      description: "Certificate type to issue",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const certificateType =
          args.type === "development" ? "IOS_DEVELOPMENT" : "IOS_DISTRIBUTION";
        yield* Console.log("Generating CSR and requesting certificate from Apple...");

        const attempt = generateAndUploadDistributionCertificate(api, {
          ascApiKeyId: args["asc-key-id"],
          certificateType,
        });

        const created = yield* attempt.pipe(
          Effect.catchTag("CertificateLimitError", () =>
            handleCertLimitInteractive(api, args["asc-key-id"], certificateType).pipe(
              Effect.flatMap(() => attempt),
            ),
          ),
        );

        yield* Console.log("Distribution certificate generated and stored.");
        yield* printKeyValue([
          ["ID", created.id],
          ["Serial", created.serialNumber],
          ["Apple team", created.appleTeamId],
          ["Apple cert", created.developerPortalIdentifier],
        ]);
      }),
      GENERATE_EXIT_EXTRAS,
    ),
});

const handleCertLimitInteractive = (
  api: ApiClient,
  ascApiKeyId: string,
  certificateType: "IOS_DISTRIBUTION" | "IOS_DEVELOPMENT",
) =>
  Effect.gen(function* () {
    yield* Console.log("");
    yield* Console.log("Apple reports the certificate limit was hit (max 3 distribution certs).");
    const certs = yield* listAppleCertificates(api, { ascApiKeyId, certificateType });
    if (certs.length === 0) {
      return yield* Effect.fail(
        new CertificateLimitError({
          message:
            "Apple says the certificate limit is hit but no existing certificates were returned — try again later.",
        }),
      );
    }
    const toRevoke = yield* promptMultiSelect<string>(
      "Select one or more certificates to revoke before retrying",
      certs.map((entry) => ({
        value: entry.id,
        label: `${entry.serialNumber.slice(0, 12)}… (${entry.displayName ?? entry.certificateType}, exp ${entry.expirationDate.slice(0, 10)})`,
      })),
      { required: true },
    );
    yield* Effect.forEach(
      toRevoke,
      (id) => revokeAppleCertificate(api, { ascApiKeyId, developerPortalIdentifier: id }),
      { concurrency: "inherit" },
    );
    yield* Console.log(`Revoked ${toRevoke.length} certificate(s); retrying generation...`);
    return undefined;
  });

const provisioningProfileCommand = defineCommand({
  meta: {
    name: "provisioning-profile",
    description:
      "Generate an iOS provisioning profile via the App Store Connect API and store the resulting .mobileprovision",
  },
  args: {
    "asc-key-id": {
      type: "string",
      required: true,
      description: "ASC API key ID (from `credentials list`)",
    },
    "cert-id": {
      type: "string",
      required: true,
      description: "Distribution certificate ID (from `credentials list`)",
    },
    bundle: { type: "string", required: true, description: "Bundle identifier" },
    distribution: {
      type: "enum",
      options: ["APP_STORE", "AD_HOC", "DEVELOPMENT", "ENTERPRISE"],
      required: true,
      description: "Distribution type",
    },
    "device-ids": {
      type: "string",
      description: "Comma-separated better-update device IDs (required for AD_HOC/DEVELOPMENT)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const deviceIds = parseDeviceIds(args["device-ids"]);
        const created = yield* generateAndUploadProvisioningProfile(api, {
          ascApiKeyId: args["asc-key-id"],
          distributionCertificateId: args["cert-id"],
          bundleIdentifier: args.bundle,
          distributionType: args.distribution,
          ...(deviceIds === undefined ? {} : { deviceIds }),
        });
        yield* Console.log("Provisioning profile generated and stored.");
        yield* printKeyValue([
          ["ID", created.id],
          ["Bundle", created.bundleIdentifier],
          ["Distribution", created.distributionType],
          ["Profile name", created.profileName ?? "-"],
          ["Valid until", created.validUntil ?? "-"],
          ["Apple profile", created.developerPortalIdentifier ?? "-"],
        ]);
      }),
      GENERATE_EXIT_EXTRAS,
    ),
});

const parseDeviceIds = (raw: string | undefined): readonly string[] | undefined => {
  if (raw === undefined || raw.length === 0) {
    return undefined;
  }
  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  return ids.length === 0 ? undefined : ids;
};

export const generateCommand = defineCommand({
  meta: { name: "generate", description: "Generate signing credentials" },
  subCommands: {
    keystore: keystoreCommand,
    "distribution-certificate": distributionCertificateCommand,
    "provisioning-profile": provisioningProfileCommand,
  },
});
