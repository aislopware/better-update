import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import {
  CertificateLimitError,
  generateAndUploadDistributionCertificate,
  generateAndUploadKeystore,
  generateAndUploadProvisioningProfile,
  listAppleCertificates,
  revokeAppleCertificate,
} from "../../lib/credentials-generator";
import { uploadCredential } from "../../lib/credentials-manager";
import { CredentialValidationError } from "../../lib/exit-codes";
import { printHuman, printHumanKeyValue } from "../../lib/output";
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
    // @effect-diagnostics-next-line effect/effectSucceedWithVoid:off -- undefined is a load-bearing success value (number | undefined); Effect.void breaks downstream compact()/validityDays?: number typing
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
      ...compact({ validityDays }),
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
        yield* printHuman("Generating keystore with keytool...");
        const created = yield* generateAndUploadKeystore(api, {
          keyAlias: resolved.alias,
          storePassword: resolved.storePassword,
          keyPassword: resolved.keyPassword,
          commonName: resolved.commonName,
          organization: resolved.organization,
          ...compact({ validityDays: resolved.validityDays }),
        });
        yield* printHuman("");
        yield* printHuman("Keystore generated and uploaded.");
        yield* printHumanKeyValue([
          ["ID", created.id],
          ["Alias", created.keyAlias],
        ]);
        return created;
      }),
      { exits: GENERATE_EXIT_EXTRAS, json: "value" },
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
        yield* printHuman("Generating CSR and requesting certificate from Apple...");

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

        yield* printHuman("Distribution certificate generated and stored.");
        yield* printHumanKeyValue([
          ["ID", created.id],
          ["Serial", created.serialNumber],
          ["Apple team", created.appleTeamIdentifier],
          ["Apple cert", created.developerPortalIdentifier],
        ]);
        return created;
      }),
      { exits: GENERATE_EXIT_EXTRAS, json: "value" },
    ),
});

const handleCertLimitInteractive = (
  api: ApiClient,
  ascApiKeyId: string,
  certificateType: "IOS_DISTRIBUTION" | "IOS_DEVELOPMENT",
) =>
  Effect.gen(function* () {
    yield* printHuman("");
    yield* printHuman("Apple reports the certificate limit was hit (max 3 distribution certs).");
    const certs = yield* listAppleCertificates(api, { ascApiKeyId, certificateType });
    if (certs.length === 0) {
      return yield* new CertificateLimitError({
        message:
          "Apple says the certificate limit is hit but no existing certificates were returned — try again later.",
      });
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
    yield* printHuman(`Revoked ${toRevoke.length} certificate(s); retrying generation...`);
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
          ...compact({ deviceIds }),
        });
        yield* printHuman("Provisioning profile generated and stored.");
        yield* printHumanKeyValue([
          ["ID", created.id],
          ["Bundle", created.bundleIdentifier],
          ["Distribution", created.distributionType],
          ["Profile name", created.profileName ?? "-"],
          ["Valid until", created.validUntil ?? "-"],
          ["Apple profile", created.developerPortalIdentifier ?? "-"],
        ]);
        return created;
      }),
      { exits: GENERATE_EXIT_EXTRAS, json: "value" },
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

const APPLE_PUSH_KEY_PORTAL_URL = "https://developer.apple.com/account/resources/authkeys/list";
const KEY_ID_PATTERN = /^[A-Z0-9]{10}$/u;
const APPLE_TEAM_ID_PATTERN = /^[A-Z0-9]{10}$/u;

const resolveAppleTeamFromAscKey = (api: ApiClient, ascApiKeyId: string | undefined) =>
  Effect.gen(function* () {
    if (ascApiKeyId === undefined) {
      return undefined;
    }
    const ascKeys = yield* api.ascApiKeys.list();
    const match = ascKeys.items.find((entry) => entry.id === ascApiKeyId);
    const teamId = match?.appleTeamId;
    return typeof teamId === "string" ? teamId : undefined;
  });

interface PushKeyArgs {
  readonly "key-id"?: string | undefined;
  readonly "apple-team-id"?: string | undefined;
  readonly p8?: string | undefined;
  readonly "asc-key-id"?: string | undefined;
  readonly name?: string | undefined;
  readonly "skip-portal-hint"?: boolean | undefined;
}

const validateKeyId = (value: string) =>
  KEY_ID_PATTERN.test(value)
    ? Effect.succeed(value)
    : Effect.fail(
        new CredentialValidationError({
          message: `Push key ID "${value}" must be 10 uppercase alphanumeric characters.`,
        }),
      );

const validateAppleTeamId = (value: string) =>
  APPLE_TEAM_ID_PATTERN.test(value)
    ? Effect.succeed(value)
    : Effect.fail(
        new CredentialValidationError({
          message: `Apple Team ID "${value}" must be 10 uppercase alphanumeric characters.`,
        }),
      );

const pushKeyCommand = defineCommand({
  meta: {
    name: "push-key",
    description:
      "Register an APNs auth key (.p8) — guides you through creating one in the Apple Developer portal, then uploads it",
  },
  args: {
    "key-id": { type: "string", description: "APNs key ID (10 uppercase alphanumeric)" },
    "apple-team-id": { type: "string", description: "Apple Team identifier" },
    p8: { type: "string", description: "Path to the AuthKey_XXXXXXXXXX.p8 file" },
    "asc-key-id": {
      type: "string",
      description: "ASC API key ID to derive --apple-team-id automatically",
    },
    name: { type: "string", description: "Display name (defaults to the key ID)" },
    "skip-portal-hint": {
      type: "boolean",
      description: "Skip the Apple Developer portal URL hint (already created the key)",
    },
  },
  run: async ({ args }: { readonly args: PushKeyArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;

        if (args["skip-portal-hint"] !== true) {
          yield* printHuman("Apple does not expose APNs key creation via the public ASC API.");
          yield* printHuman("Create the key here, download the .p8, then come back:");
          yield* printHuman(`  ${APPLE_PUSH_KEY_PORTAL_URL}`);
          yield* printHuman("");
        }

        const resolved = yield* resolvePushKeyInput(api, args);
        yield* printHuman("Uploading APNs auth key...");
        const credential = yield* uploadCredential(api, {
          platform: "ios",
          type: "push-key",
          name: resolved.name,
          filePath: resolved.p8Path,
          keyId: resolved.keyId,
          appleTeamIdentifier: resolved.appleTeamIdentifier,
        });
        yield* printHuman("APNs push key registered.");
        yield* printHumanKeyValue([
          ["ID", credential.id],
          ["Key ID", resolved.keyId],
          ["Apple team", resolved.appleTeamIdentifier],
        ]);
        return credential;
      }),
      { exits: GENERATE_EXIT_EXTRAS, json: "value" },
    ),
});

const resolvePushKeyInput = (api: ApiClient, args: PushKeyArgs) =>
  Effect.gen(function* () {
    const derivedTeamId = yield* resolveAppleTeamFromAscKey(api, args["asc-key-id"]);

    const rawKeyId =
      args["key-id"] ?? (yield* promptText("APNs key ID (10 uppercase alphanumeric)"));
    const keyId = yield* validateKeyId(rawKeyId.trim().toUpperCase());

    const rawTeamId =
      args["apple-team-id"] ??
      derivedTeamId ??
      (yield* promptText("Apple Team identifier (10 uppercase alphanumeric)"));
    const appleTeamIdentifier = yield* validateAppleTeamId(rawTeamId.trim().toUpperCase());

    const p8Path =
      args.p8 ?? (yield* promptText("Path to the AuthKey_XXXXXXXXXX.p8 file you downloaded"));
    if (p8Path.trim().length === 0) {
      return yield* new CredentialValidationError({ message: "Missing --p8 path" });
    }

    const name = args.name ?? keyId;
    return { keyId, appleTeamIdentifier, p8Path, name };
  });

const GSA_FIREBASE_URL =
  "https://console.firebase.google.com/project/_/settings/serviceaccounts/adminsdk";
const GSA_GCP_URL = "https://console.cloud.google.com/iam-admin/serviceaccounts";

interface GsaKeyArgs {
  readonly file?: string | undefined;
  readonly name?: string | undefined;
  readonly purpose?: "fcm" | "play" | undefined;
  readonly "skip-portal-hint"?: boolean | undefined;
}

const gsaKeyCommand = defineCommand({
  meta: {
    name: "gsa-key",
    description:
      "Register a Google Service Account JSON key — guides you through creating one in the Firebase/GCP console, then uploads it",
  },
  args: {
    file: { type: "string", description: "Path to the Google service account JSON file" },
    name: { type: "string", description: "Display name (defaults to the file name)" },
    purpose: {
      type: "enum",
      options: ["fcm", "play"],
      description:
        "Where this key will be used: fcm (Firebase Cloud Messaging V1) or play (Play Store submissions)",
    },
    "skip-portal-hint": {
      type: "boolean",
      description: "Skip the Firebase/GCP portal URL hint (already downloaded the key)",
    },
  },
  run: async ({ args }: { readonly args: GsaKeyArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;

        if (args["skip-portal-hint"] !== true) {
          yield* printHuman(
            "Google does not expose service-account key creation via a public API.",
          );
          yield* printHuman(
            "Create one in the appropriate console, download the JSON, then come back:",
          );
          if (args.purpose === "play") {
            yield* printHuman(`  Play submissions (GCP IAM): ${GSA_GCP_URL}`);
          } else if (args.purpose === "fcm") {
            yield* printHuman(`  FCM V1 push (Firebase console): ${GSA_FIREBASE_URL}`);
          } else {
            yield* printHuman(`  FCM V1 push (Firebase): ${GSA_FIREBASE_URL}`);
            yield* printHuman(`  Play submissions (GCP IAM): ${GSA_GCP_URL}`);
          }
          yield* printHuman("");
        }

        const filePath =
          args.file !== undefined && args.file.trim().length > 0
            ? args.file
            : yield* promptText("Path to the Google service account JSON file");
        if (filePath.trim().length === 0) {
          return yield* new CredentialValidationError({ message: "Missing --file path" });
        }
        const name = args.name ?? filePath;

        yield* printHuman("Uploading Google service account key...");
        const credential = yield* uploadCredential(api, {
          platform: "android",
          type: "google-service-account-key",
          name,
          filePath,
        });
        yield* printHuman("Google service account key registered.");
        yield* printHumanKeyValue([
          ["ID", credential.id],
          ["Name", credential.name],
        ]);
        return credential;
      }),
      { exits: GENERATE_EXIT_EXTRAS, json: "value" },
    ),
});

export const generateCommand = defineCommand({
  meta: { name: "generate", description: "Generate signing credentials" },
  subCommands: {
    keystore: keystoreCommand,
    "distribution-certificate": distributionCertificateCommand,
    "provisioning-profile": provisioningProfileCommand,
    "push-key": pushKeyCommand,
    "gsa-key": gsaKeyCommand,
  },
});
