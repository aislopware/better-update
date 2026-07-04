import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { CertificateLimitError, generateAndUploadKeystore } from "../../lib/credentials-generator";
import {
  ascKeyRequestContext,
  generateAndUploadDistributionCertificate,
  generateAndUploadProvisioningProfile,
  listDistributionCerts,
  revokeDistributionCert,
} from "../../lib/credentials-generator-apple";
import { uploadCredential } from "../../lib/credentials-manager";
import { CredentialValidationError } from "../../lib/exit-codes";
import { printHuman, printHumanKeyValue } from "../../lib/output";
import { promptMultiSelect, promptPassword, promptText } from "../../lib/prompts";
import { apiClient } from "../../services/api-client";
import { ascKeyCommand } from "./generate-asc-key";
import { merchantIdCommand } from "./generate-merchant-id";
import { pushKeyCommand } from "./generate-push-key";

import type { AppleCertificateType } from "../../lib/credentials-generator-apple";

const GENERATE_EXIT_EXTRAS = {
  CredentialValidationError: 2,
  BuildFailedError: 6,
  AppleIdGenerateFailedError: 6,
  CertificateLimitError: 6,
} as const;

const ensureNonEmpty = (value: string | undefined, label: string) =>
  value === undefined || value.trim().length === 0
    ? Effect.fail(new CredentialValidationError({ message: `Missing --${label}` }))
    : Effect.succeed(value);

interface KeystoreCliArgs {
  readonly name?: string | undefined;
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
    const name = args.name !== undefined && args.name.trim().length > 0 ? args.name : undefined;
    return {
      alias: yield* ensureNonEmpty(alias, "alias"),
      storePassword: yield* ensureNonEmpty(storePassword, "store-password"),
      keyPassword: yield* ensureNonEmpty(keyPassword, "key-password"),
      commonName: yield* ensureNonEmpty(commonName, "common-name"),
      organization: yield* ensureNonEmpty(organization, "organization"),
      ...compact({ validityDays, name }),
    };
  });

const keystoreCommand = defineCommand({
  meta: {
    name: "keystore",
    description: "Generate a new Android upload keystore via keytool and store it server-side",
  },
  args: {
    name: { type: "string", description: "Display name (label shown in `credentials list`)" },
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
          ...compact({ validityDays: resolved.validityDays, name: resolved.name }),
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

const CLI_TYPE_TO_CERTIFICATE_TYPE: Record<string, AppleCertificateType> = {
  distribution: "IOS_DISTRIBUTION",
  development: "IOS_DEVELOPMENT",
  "developer-id": "DEVELOPER_ID_APPLICATION",
};

const distributionCertificateCommand = defineCommand({
  meta: {
    name: "distribution-certificate",
    description:
      "Generate an Apple signing certificate via the App Store Connect API and store the resulting .p12 (iOS distribution/development, or Developer ID for macOS apps distributed outside the Mac App Store)",
  },
  args: {
    "asc-key-id": {
      type: "string",
      required: true,
      description: "ASC API key ID (from `credentials list`)",
    },
    type: {
      type: "enum",
      options: ["distribution", "development", "developer-id"],
      default: "distribution",
      description:
        "Certificate type to issue (developer-id = macOS Developer ID Application; Apple only lets the Account Holder create these)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const certificateType = CLI_TYPE_TO_CERTIFICATE_TYPE[args.type] ?? "IOS_DISTRIBUTION";
        if (certificateType === "DEVELOPER_ID_APPLICATION") {
          yield* printHuman(
            "Note: Apple only issues Developer ID certificates to the team's Account Holder — this fails with a permissions error for other roles.",
          );
        }
        yield* printHuman("Requesting a distribution certificate from Apple...");

        const context = yield* ascKeyRequestContext(api, args["asc-key-id"]);
        const attempt = generateAndUploadDistributionCertificate(api, { context, certificateType });

        const created = yield* attempt.pipe(
          Effect.catchTag("CertificateLimitError", () =>
            handleCertLimitInteractive(context, certificateType).pipe(
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
  context: Parameters<typeof listDistributionCerts>[0],
  certificateType: AppleCertificateType,
) =>
  Effect.gen(function* () {
    yield* printHuman("");
    yield* printHuman("Apple reports the certificate limit for this certificate type was hit.");
    const certs = yield* listDistributionCerts(context, certificateType);
    if (certs.length === 0) {
      return yield* new CertificateLimitError({
        message:
          "Apple says the certificate limit is hit but no existing certificates were returned — try again later.",
      });
    }
    const toRevoke = yield* promptMultiSelect<string>(
      "Select one or more certificates to revoke before retrying",
      certs.map((entry) => ({
        value: entry.developerPortalIdentifier,
        label: `${entry.serialNumber.slice(0, 12)}… (${entry.displayName || entry.certificateType}, exp ${entry.expirationDate.slice(0, 10)})`,
      })),
      { required: true },
    );
    yield* Effect.forEach(toRevoke, (id) => revokeDistributionCert(context, id), {
      concurrency: "inherit",
    });
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
        const context = yield* ascKeyRequestContext(api, args["asc-key-id"]);
        const created = yield* generateAndUploadProvisioningProfile(api, {
          context,
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
    "merchant-id": merchantIdCommand,
    "asc-key": ascKeyCommand,
    "gsa-key": gsaKeyCommand,
  },
});
