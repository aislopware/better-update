import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { CredentialValidationError } from "../../lib/exit-codes";
import { printHumanKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";

import type { ApiClient } from "../../services/api-client";

const CREDENTIAL_TYPES = [
  "distribution-certificate",
  "provisioning-profile",
  "push-key",
  "asc-api-key",
  "keystore",
  "google-service-account-key",
] as const;

type CredentialType = (typeof CREDENTIAL_TYPES)[number];

const notFound = (id: string, type: CredentialType) =>
  new CredentialValidationError({ message: `${type} with ID "${id}" not found.` });

const viewDistributionCertificate = (api: ApiClient, id: string) =>
  Effect.gen(function* () {
    const { items } = yield* api.appleDistributionCertificates.list();
    const item = items.find((entry) => entry.id === id);
    if (!item) {
      return yield* notFound(id, "distribution-certificate");
    }
    return {
      kind: "distribution-certificate" as const,
      pairs: [
        ["ID", item.id],
        ["Type", "Apple distribution certificate"],
        ["Apple team ID", item.appleTeamId],
        ["Serial number", item.serialNumber],
        ["Developer ID", item.developerIdIdentifier ?? "-"],
        ["Valid from", item.validFrom],
        ["Valid until", item.validUntil],
        ["Created", item.createdAt],
        ["Updated", item.updatedAt],
      ] as const,
      raw: item,
    };
  });

const viewProvisioningProfile = (api: ApiClient, id: string) =>
  Effect.gen(function* () {
    const { items } = yield* api.appleProvisioningProfiles.list({ urlParams: {} });
    const item = items.find((entry) => entry.id === id);
    if (!item) {
      return yield* notFound(id, "provisioning-profile");
    }
    return {
      kind: "provisioning-profile" as const,
      pairs: [
        ["ID", item.id],
        ["Type", "Apple provisioning profile"],
        ["Bundle identifier", item.bundleIdentifier],
        ["Distribution", item.distributionType],
        ["Profile name", item.profileName ?? "-"],
        ["Apple team ID", item.appleTeamId],
        ["Distribution cert ID", item.appleDistributionCertificateId ?? "-"],
        ["Apple profile", item.developerPortalIdentifier ?? "-"],
        ["Valid until", item.validUntil ?? "-"],
        ["Created", item.createdAt],
        ["Updated", item.updatedAt],
      ] as const,
      raw: item,
    };
  });

const viewPushKey = (api: ApiClient, id: string) =>
  Effect.gen(function* () {
    const { items } = yield* api.applePushKeys.list();
    const item = items.find((entry) => entry.id === id);
    if (!item) {
      return yield* notFound(id, "push-key");
    }
    return {
      kind: "push-key" as const,
      pairs: [
        ["ID", item.id],
        ["Type", "Apple APNs auth key"],
        ["Key ID", item.keyId],
        ["Apple team ID", item.appleTeamId],
        ["Created", item.createdAt],
        ["Updated", item.updatedAt],
      ] as const,
      raw: item,
    };
  });

const viewAscApiKey = (api: ApiClient, id: string) =>
  Effect.gen(function* () {
    const { items } = yield* api.ascApiKeys.list();
    const item = items.find((entry) => entry.id === id);
    if (!item) {
      return yield* notFound(id, "asc-api-key");
    }
    return {
      kind: "asc-api-key" as const,
      pairs: [
        ["ID", item.id],
        ["Type", "App Store Connect API key"],
        ["Name", item.name],
        ["Key ID", item.keyId],
        ["Apple team ID", item.appleTeamId ?? "-"],
        ["Roles", item.roles.length === 0 ? "-" : item.roles.join(", ")],
        ["Created", item.createdAt],
        ["Updated", item.updatedAt],
      ] as const,
      raw: item,
    };
  });

const viewKeystore = (api: ApiClient, id: string) =>
  Effect.gen(function* () {
    const { items } = yield* api.androidUploadKeystores.list();
    const item = items.find((entry) => entry.id === id);
    if (!item) {
      return yield* notFound(id, "keystore");
    }
    return {
      kind: "keystore" as const,
      pairs: [
        ["ID", item.id],
        ["Type", "Android upload keystore"],
        ["Key alias", item.keyAlias],
        ["Created", item.createdAt],
        ["Updated", item.updatedAt],
      ] as const,
      raw: item,
    };
  });

const viewGoogleServiceAccountKey = (api: ApiClient, id: string) =>
  Effect.gen(function* () {
    const { items } = yield* api.googleServiceAccountKeys.list();
    const item = items.find((entry) => entry.id === id);
    if (!item) {
      return yield* notFound(id, "google-service-account-key");
    }
    return {
      kind: "google-service-account-key" as const,
      pairs: [
        ["ID", item.id],
        ["Type", "Google service account key"],
        ["Client email", item.clientEmail],
        ["Google project ID", item.googleProjectId],
        ["Private key ID", item.privateKeyId],
        ["Created", item.createdAt],
        ["Updated", item.updatedAt],
      ] as const,
      raw: item,
    };
  });

const lookupByType = (api: ApiClient, id: string, type: CredentialType) => {
  switch (type) {
    case "distribution-certificate": {
      return viewDistributionCertificate(api, id);
    }
    case "provisioning-profile": {
      return viewProvisioningProfile(api, id);
    }
    case "push-key": {
      return viewPushKey(api, id);
    }
    case "asc-api-key": {
      return viewAscApiKey(api, id);
    }
    case "keystore": {
      return viewKeystore(api, id);
    }
    case "google-service-account-key": {
      return viewGoogleServiceAccountKey(api, id);
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

export const viewCommand = defineCommand({
  meta: { name: "view", description: "Show details for a single credential (without secrets)" },
  args: {
    id: { type: "positional", required: true, description: "Credential ID" },
    type: {
      type: "enum",
      options: [...CREDENTIAL_TYPES],
      required: true,
      description: "Credential type",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const result = yield* lookupByType(api, args.id, args.type);
        yield* printHumanKeyValue(result.pairs.map((pair) => [pair[0], pair[1]] as const));
        return result.raw;
      }),
      { json: "value" },
    ),
});
