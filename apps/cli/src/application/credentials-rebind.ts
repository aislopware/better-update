import { Console, Effect } from "effect";

import { IOS_DISTRIBUTION_TO_TYPE } from "../lib/credentials-downloader";
import { MissingCredentialsError } from "../lib/exit-codes";
import { printKeyValue } from "../lib/output";
import { promptSelect } from "../lib/prompts";
import {
  pickIosAscKey,
  pickIosCertificate,
  resolveAndroidKeystoreId,
  resolveIosProfileId,
} from "./credentials-interactive";

import type { ApiClient } from "../services/api-client";
import type { AndroidSetupInput, IosSetupContext, IosSetupInput } from "./credentials-interactive";

// ── Android ────────────────────────────────────────────────────────

const findAndroidGroup = (api: ApiClient, input: AndroidSetupInput) =>
  Effect.gen(function* () {
    const apps = yield* api.androidApplicationIdentifiers.list({
      path: { projectId: input.projectId },
    });
    const app = apps.items.find((entry) => entry.packageName === input.applicationIdentifier);
    if (app === undefined) {
      return { app: undefined, group: undefined } as const;
    }
    const groups = yield* api.androidBuildCredentials.list({
      path: { applicationIdentifierId: app.id },
    });
    const group = groups.items.find((entry) => entry.isDefault) ?? groups.items.at(0);
    return { app, group } as const;
  });

const resolveKeystoreLabel = (api: ApiClient, keystoreId: string | null) =>
  Effect.gen(function* () {
    if (keystoreId === null) {
      return "-";
    }
    const keystores = yield* api.androidUploadKeystores.list();
    const match = keystores.items.find((entry) => entry.id === keystoreId);
    return match === undefined ? keystoreId : `${match.keyAlias} (${match.id.slice(0, 8)}…)`;
  });

export const showAndroidBinding = (api: ApiClient, input: AndroidSetupInput) =>
  Effect.gen(function* () {
    const { group } = yield* findAndroidGroup(api, input);
    if (group === undefined) {
      yield* Console.log(
        `No Android build credentials registered for ${input.applicationIdentifier}.`,
      );
      return;
    }
    const keystoreLabel = yield* resolveKeystoreLabel(api, group.androidUploadKeystoreId);
    yield* printKeyValue([
      ["Application", input.applicationIdentifier],
      ["Group", group.name],
      ["Group ID", group.id],
      ["Default", group.isDefault ? "yes" : "no"],
      ["Keystore", keystoreLabel],
    ]);
  });

export const rebindAndroidKeystore = (api: ApiClient, input: AndroidSetupInput) =>
  Effect.gen(function* () {
    const { group } = yield* findAndroidGroup(api, input);
    if (group === undefined) {
      return yield* new MissingCredentialsError({
        message: `No Android build credentials group to rebind for ${input.applicationIdentifier}.`,
        hint: "Run `better-update credentials configure --platform android` (without --rebind) first.",
      });
    }

    yield* Console.log(
      `Rebinding default Android build credentials for ${input.applicationIdentifier}.`,
    );

    const choice = yield* promptSelect<"generate" | "existing">("Pick a keystore to bind:", [
      { value: "existing", label: "Pick an existing keystore" },
      { value: "generate", label: "Generate a new keystore" },
    ]);
    const keystoreId = yield* resolveAndroidKeystoreId(api, choice);

    yield* api.androidBuildCredentials.update({
      path: { id: group.id },
      payload: { androidUploadKeystoreId: keystoreId },
    });
    yield* Console.log("Default Android keystore rebind complete.");
    return undefined;
  });

// ── iOS ────────────────────────────────────────────────────────────

const fetchIosBinding = (api: ApiClient, input: IosSetupInput) =>
  Effect.gen(function* () {
    const distributionType = IOS_DISTRIBUTION_TO_TYPE[input.distribution];
    const configs = yield* api.iosBundleConfigurations.list({
      path: { projectId: input.projectId },
    });
    return configs.items.find(
      (entry) =>
        entry.bundleIdentifier === input.bundleIdentifier &&
        entry.distributionType === distributionType,
    );
  });

const labelDistributionCertificate = (api: ApiClient, id: string | null) =>
  Effect.gen(function* () {
    if (id === null) {
      return "-";
    }
    const certs = yield* api.appleDistributionCertificates.list();
    const match = certs.items.find((entry) => entry.id === id);
    return match === undefined
      ? id
      : `${match.serialNumber.slice(0, 12)}… (team ${match.appleTeamId})`;
  });

const labelProvisioningProfile = (api: ApiClient, id: string | null) =>
  Effect.gen(function* () {
    if (id === null) {
      return "-";
    }
    const profiles = yield* api.appleProvisioningProfiles.list({ urlParams: {} });
    const match = profiles.items.find((entry) => entry.id === id);
    if (match === undefined) {
      return id;
    }
    return match.profileName ?? match.developerPortalIdentifier ?? id;
  });

const labelAscApiKey = (api: ApiClient, id: string | null) =>
  Effect.gen(function* () {
    if (id === null) {
      return "-";
    }
    const keys = yield* api.ascApiKeys.list();
    const match = keys.items.find((entry) => entry.id === id);
    return match === undefined ? id : `${match.name} (${match.keyId})`;
  });

const labelPushKey = (api: ApiClient, id: string | null) =>
  Effect.gen(function* () {
    if (id === null) {
      return "-";
    }
    const keys = yield* api.applePushKeys.list();
    const match = keys.items.find((entry) => entry.id === id);
    return match === undefined ? id : match.keyId;
  });

export const showIosBinding = (api: ApiClient, input: IosSetupInput) =>
  Effect.gen(function* () {
    const config = yield* fetchIosBinding(api, input);
    if (config === undefined) {
      yield* Console.log(
        `No iOS bundle configuration for ${input.bundleIdentifier} (${input.distribution}).`,
      );
      return;
    }
    const [certLabel, profileLabel, ascLabel, pushLabel] = yield* Effect.all(
      [
        labelDistributionCertificate(api, config.appleDistributionCertificateId),
        labelProvisioningProfile(api, config.appleProvisioningProfileId),
        labelAscApiKey(api, config.ascApiKeyId),
        labelPushKey(api, config.applePushKeyId),
      ],
      { concurrency: "unbounded" },
    );
    yield* printKeyValue([
      ["Bundle", config.bundleIdentifier],
      ["Distribution", config.distributionType],
      ["Apple team", config.appleTeamId],
      ["Bundle config ID", config.id],
      ["Distribution cert", certLabel],
      ["Provisioning profile", profileLabel],
      ["ASC API key", ascLabel],
      ["APNs push key", pushLabel],
    ]);
  });

export const rebindIosBundle = (api: ApiClient, input: IosSetupInput) =>
  Effect.gen(function* () {
    const config = yield* fetchIosBinding(api, input);
    if (config === undefined) {
      return yield* new MissingCredentialsError({
        message: `No iOS bundle configuration to rebind for ${input.bundleIdentifier} (${input.distribution}).`,
        hint: "Run `better-update credentials configure --platform ios` (without --rebind) first.",
      });
    }

    yield* Console.log(`Rebinding iOS bundle ${input.bundleIdentifier} (${input.distribution}).`);

    const { certId, cert } = yield* pickIosCertificate(api);
    const ascKeyId = yield* pickIosAscKey(api, cert.appleTeamId);
    const distributionType = IOS_DISTRIBUTION_TO_TYPE[input.distribution];
    const ctx: IosSetupContext = { certId, cert, ascKeyId, distributionType };
    const profileId = yield* resolveIosProfileId(api, input, ctx);

    yield* api.iosBundleConfigurations.update({
      path: { id: config.id },
      payload: {
        appleDistributionCertificateId: certId,
        appleProvisioningProfileId: profileId,
        ascApiKeyId: ascKeyId,
      },
    });
    yield* Console.log("iOS bundle configuration rebind complete.");
    return undefined;
  });
