import { Console, Effect } from "effect";

import { generateAndUploadDistributionCertificate } from "../lib/credentials-generator";
import { uploadCredential } from "../lib/credentials-manager";
import { CredentialValidationError, MissingCredentialsError } from "../lib/exit-codes";
import { printHuman, printKeyValue } from "../lib/output";
import { promptSelect, promptText } from "../lib/prompts";
import {
  ensureIosCredentials,
  pickIosAscKey,
  pickIosCertificate,
  resolveIosProfileId,
} from "./credentials-interactive";
import {
  announce,
  APPLE_PUSH_KEY_PORTAL_URL,
  BACK,
  DISTRIBUTION_OPTIONS,
  matchDistribution,
  pickAndDelete,
  promptForBundleConfig,
  safely,
  safePrompt,
} from "./credentials-manager-shared";
import { showIosBinding } from "./credentials-rebind";

import type { IosDistribution } from "../lib/build-profile";
import type { IosSetupContext } from "./credentials-interactive";
import type { MenuEffect, WizardContext } from "./credentials-manager-shared";

const APPLE_TEN_CHARS = /^[A-Z0-9]{10}$/u;

// ── Actions ──────────────────────────────────────────────────────

const setupIosProjectCredentials = (ctx: WizardContext) =>
  Effect.gen(function* () {
    const bundleIdentifier = ctx.iosBundleId ?? (yield* promptText("iOS bundle identifier"));
    const distribution = yield* promptSelect<IosDistribution>(
      "Distribution type",
      DISTRIBUTION_OPTIONS,
    );
    yield* ensureIosCredentials(
      ctx.api,
      { projectId: ctx.projectId, bundleIdentifier, distribution },
      { freezeCredentials: false },
    );
    yield* Console.log("");
    yield* showIosBinding(ctx.api, {
      projectId: ctx.projectId,
      bundleIdentifier,
      distribution,
    });
  });

const useExistingIosDistributionCert = (ctx: WizardContext) =>
  Effect.gen(function* () {
    const config = yield* promptForBundleConfig(ctx);
    yield* Console.log(
      `Re-binding distribution certificate + provisioning profile for ${config.bundleIdentifier} (${config.distributionType}).`,
    );
    const { certId, cert } = yield* pickIosCertificate(ctx.api);
    const ascKeyId = yield* pickIosAscKey(ctx.api, cert.appleTeamId);
    const setupCtx: IosSetupContext = {
      certId,
      cert,
      ascKeyId,
      distributionType: config.distributionType,
    };
    const profileId = yield* resolveIosProfileId(
      ctx.api,
      {
        projectId: ctx.projectId,
        bundleIdentifier: config.bundleIdentifier,
        distribution: matchDistribution(config.distributionType),
      },
      setupCtx,
    );
    yield* ctx.api.iosBundleConfigurations.update({
      path: { id: config.id },
      payload: {
        appleDistributionCertificateId: certId,
        appleProvisioningProfileId: profileId,
        ascApiKeyId: ascKeyId,
      },
    });
    yield* Console.log("Bundle configuration updated.");
  });

const generateNewIosDistributionCert = (ctx: WizardContext) =>
  Effect.gen(function* () {
    const ascKeys = yield* ctx.api.ascApiKeys.list();
    const teamKeys = ascKeys.items.filter((entry) => entry.appleTeamId !== null);
    if (teamKeys.length === 0) {
      return yield* new MissingCredentialsError({
        message: "No ASC API key linked to an Apple team.",
        hint: "Upload an ASC API key first (App Store Connect API Key > Upload).",
      });
    }
    const ascKeyId = yield* promptSelect<string>(
      "ASC API key to issue against",
      teamKeys.map((key) => ({ value: key.id, label: `${key.name} (${key.keyId})` })),
    );
    yield* Console.log("Generating CSR and requesting certificate from Apple...");
    const created = yield* generateAndUploadDistributionCertificate(ctx.api, {
      ascApiKeyId: ascKeyId,
    });
    yield* Console.log("Distribution certificate generated.");
    yield* printKeyValue([
      ["ID", created.id],
      ["Serial", created.serialNumber],
      ["Apple team", created.appleTeamId],
    ]);
    return undefined;
  });

const addIosPushKey = (ctx: WizardContext) =>
  Effect.gen(function* () {
    yield* printHuman("Apple does not expose APNs key creation via API.");
    yield* printHuman(`Create one here, download .p8, then return: ${APPLE_PUSH_KEY_PORTAL_URL}`);
    const keyId = (yield* promptText("APNs key ID (10 uppercase alphanumeric)"))
      .trim()
      .toUpperCase();
    if (!APPLE_TEN_CHARS.test(keyId)) {
      return yield* new CredentialValidationError({
        message: `Push key ID "${keyId}" must be 10 uppercase alphanumeric characters.`,
      });
    }
    const ascKeys = yield* ctx.api.ascApiKeys.list();
    const teamKeys = ascKeys.items.filter((entry) => entry.appleTeamId !== null);
    const [firstKey] = teamKeys;
    const teamFromAsc =
      teamKeys.length === 1 && firstKey !== undefined && firstKey.appleTeamId !== null
        ? firstKey.appleTeamId
        : undefined;
    const appleTeamIdentifier = teamFromAsc ?? (yield* promptText("Apple Team identifier"));
    if (!APPLE_TEN_CHARS.test(appleTeamIdentifier)) {
      return yield* new CredentialValidationError({
        message: "Apple Team ID must be 10 uppercase alphanumeric characters.",
      });
    }
    const p8Path = yield* promptText("Path to the AuthKey_XXXXXXXXXX.p8 file");
    const created = yield* uploadCredential(ctx.api, {
      platform: "ios",
      type: "push-key",
      name: keyId,
      filePath: p8Path,
      keyId,
      appleTeamIdentifier,
    });
    yield* Console.log("APNs push key registered.");
    yield* printKeyValue([
      ["ID", created.id],
      ["Key ID", keyId],
      ["Apple team", appleTeamIdentifier],
    ]);
    return undefined;
  });

const bindIosPushKey = (ctx: WizardContext) =>
  Effect.gen(function* () {
    const keys = yield* ctx.api.applePushKeys.list();
    if (keys.items.length === 0) {
      return yield* new MissingCredentialsError({
        message: "No APNs auth keys uploaded yet.",
        hint: "Run 'Add a new push key' first.",
      });
    }
    const config = yield* promptForBundleConfig(ctx);
    const pushKeyId = yield* promptSelect<string>(
      "Select a push key to bind",
      keys.items.map((key) => ({ value: key.id, label: `${key.keyId} (team ${key.appleTeamId})` })),
    );
    yield* ctx.api.iosBundleConfigurations.update({
      path: { id: config.id },
      payload: { applePushKeyId: pushKeyId },
    });
    yield* Console.log(
      `Bound push key ${pushKeyId} to ${config.bundleIdentifier} (${config.distributionType}).`,
    );
    return undefined;
  });

const uploadIosAscKey = (ctx: WizardContext) =>
  Effect.gen(function* () {
    const keyId = (yield* promptText("ASC key ID (10 uppercase alphanumeric)"))
      .trim()
      .toUpperCase();
    const issuerId = yield* promptText("ASC issuer ID (UUID)");
    const p8Path = yield* promptText("Path to the ASC AuthKey_XXXXXXXXXX.p8 file");
    const rawName = yield* promptText("Display name", { defaultValue: keyId });
    const name = rawName.length === 0 ? keyId : rawName;
    const created = yield* uploadCredential(ctx.api, {
      platform: "ios",
      type: "asc-api-key",
      name,
      filePath: p8Path,
      keyId,
      issuerId,
    });
    yield* Console.log("ASC API key uploaded.");
    yield* printKeyValue([
      ["ID", created.id],
      ["Key ID", keyId],
    ]);
  });

const bindIosAscKey = (ctx: WizardContext) =>
  Effect.gen(function* () {
    const keys = yield* ctx.api.ascApiKeys.list();
    if (keys.items.length === 0) {
      return yield* new MissingCredentialsError({
        message: "No ASC API keys uploaded yet.",
        hint: "Run 'Upload a new ASC API key' first.",
      });
    }
    const config = yield* promptForBundleConfig(ctx);
    const ascKeyId = yield* promptSelect<string>(
      "Select an ASC API key to bind",
      keys.items.map((key) => ({ value: key.id, label: `${key.name} (${key.keyId})` })),
    );
    yield* ctx.api.iosBundleConfigurations.update({
      path: { id: config.id },
      payload: { ascApiKeyId: ascKeyId },
    });
    yield* Console.log(
      `Bound ASC API key ${ascKeyId} to ${config.bundleIdentifier} (${config.distributionType}).`,
    );
    return undefined;
  });

// ── Menus ────────────────────────────────────────────────────────

const iosBuildCredentialsMenu = (ctx: WizardContext): MenuEffect =>
  Effect.gen(function* () {
    yield* announce("iOS > Build Credentials");
    const choice = yield* safePrompt(
      promptSelect<string>("What do you want to do?", [
        { value: "setup", label: "Set up project credentials (cert + profile + bind)" },
        { value: "use-existing-cert", label: "Use an existing distribution certificate" },
        { value: "generate-cert", label: "Add a new distribution certificate" },
        { value: "delete-cert", label: "Delete a distribution certificate" },
        { value: "delete-profile", label: "Delete a provisioning profile" },
        { value: BACK, label: "Go back" },
      ]),
    );
    if (choice === BACK) {
      return;
    }
    if (choice === "setup") {
      yield* safely("setup", setupIosProjectCredentials(ctx));
    } else if (choice === "use-existing-cert") {
      yield* safely("use existing cert", useExistingIosDistributionCert(ctx));
    } else if (choice === "generate-cert") {
      yield* safely("generate cert", generateNewIosDistributionCert(ctx));
    } else if (choice === "delete-cert") {
      yield* safely(
        "delete cert",
        pickAndDelete(ctx, "distribution-certificate", "iOS distribution certificate"),
      );
    } else if (choice === "delete-profile") {
      yield* safely(
        "delete profile",
        pickAndDelete(ctx, "provisioning-profile", "iOS provisioning profile"),
      );
    }
    yield* iosBuildCredentialsMenu(ctx);
  });

const iosPushKeysMenu = (ctx: WizardContext): MenuEffect =>
  Effect.gen(function* () {
    yield* announce("iOS > Push Notifications");
    const choice = yield* safePrompt(
      promptSelect<string>("What do you want to do?", [
        { value: "add", label: "Add a new push key" },
        { value: "bind", label: "Bind an existing push key to a bundle" },
        { value: "remove", label: "Remove a push key" },
        { value: BACK, label: "Go back" },
      ]),
    );
    if (choice === BACK) {
      return;
    }
    if (choice === "add") {
      yield* safely("add push key", addIosPushKey(ctx));
    } else if (choice === "bind") {
      yield* safely("bind push key", bindIosPushKey(ctx));
    } else if (choice === "remove") {
      yield* safely("remove push key", pickAndDelete(ctx, "push-key", "APNs push key"));
    }
    yield* iosPushKeysMenu(ctx);
  });

const iosAscKeysMenu = (ctx: WizardContext): MenuEffect =>
  Effect.gen(function* () {
    yield* announce("iOS > App Store Connect API Key");
    const choice = yield* safePrompt(
      promptSelect<string>("What do you want to do?", [
        { value: "upload", label: "Upload a new ASC API key" },
        { value: "bind", label: "Bind an existing ASC API key to a bundle" },
        { value: "delete", label: "Delete an ASC API key" },
        { value: BACK, label: "Go back" },
      ]),
    );
    if (choice === BACK) {
      return;
    }
    if (choice === "upload") {
      yield* safely("upload ASC key", uploadIosAscKey(ctx));
    } else if (choice === "bind") {
      yield* safely("bind ASC key", bindIosAscKey(ctx));
    } else if (choice === "delete") {
      yield* safely("delete ASC key", pickAndDelete(ctx, "asc-api-key", "ASC API key"));
    }
    yield* iosAscKeysMenu(ctx);
  });

const credentialsJsonMenuIos = (): MenuEffect =>
  Effect.gen(function* () {
    yield* announce("iOS > credentials.json");
    const choice = yield* safePrompt(
      promptSelect<string>("What do you want to do?", [
        { value: "pull", label: "Download credentials to local credentials.json" },
        { value: "push", label: "Upload credentials.json to the server" },
        { value: BACK, label: "Go back" },
      ]),
    );
    if (choice === BACK) {
      return;
    }
    const cmd = choice === "pull" ? "credentials sync pull" : "credentials sync push";
    yield* printHuman(
      `Run: \`better-update ${cmd}\` from your project root for the full file-aware flow.`,
    );
    yield* credentialsJsonMenuIos();
  });

export const iosMenu = (ctx: WizardContext): MenuEffect =>
  Effect.gen(function* () {
    yield* announce("iOS");
    const choice = yield* safePrompt(
      promptSelect<string>("What do you want to manage?", [
        { value: "build", label: "Build Credentials (cert + provisioning profile)" },
        { value: "push", label: "Push Notifications (APNs auth key)" },
        { value: "asc", label: "App Store Connect API Key" },
        { value: "json", label: "credentials.json (sync push/pull)" },
        { value: BACK, label: "Go back" },
      ]),
    );
    if (choice === BACK) {
      return;
    }
    if (choice === "build") {
      yield* iosBuildCredentialsMenu(ctx);
    } else if (choice === "push") {
      yield* iosPushKeysMenu(ctx);
    } else if (choice === "asc") {
      yield* iosAscKeysMenu(ctx);
    } else if (choice === "json") {
      yield* credentialsJsonMenuIos();
    }
    yield* iosMenu(ctx);
  });
