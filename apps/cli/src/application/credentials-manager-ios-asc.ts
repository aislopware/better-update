import { Console, Effect } from "effect";

import {
  defaultAscApiKeyNickname,
  generateAndUploadAscApiKeyViaAppleId,
} from "../lib/credentials-generator-asc-key";
import { uploadCredential } from "../lib/credentials-manager";
import { MissingCredentialsError } from "../lib/exit-codes";
import { printKeyValue } from "../lib/output";
import { promptSelect, promptText } from "../lib/prompts";
import { AppleAuth } from "../services/apple-auth";
import {
  announce,
  BACK,
  pickAndDelete,
  promptForBundleConfig,
  safely,
  safePrompt,
} from "./credentials-manager-shared";

import type { AscApiKeyRole } from "../lib/credentials-generator-asc-key";
import type { MenuEffect, WizardContext } from "./credentials-manager-shared";

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

const generateAscKeyViaAppleId = (ctx: WizardContext) =>
  Effect.gen(function* () {
    const auth = yield* AppleAuth;
    const session = yield* auth.ensureLoggedIn();
    const role = yield* promptSelect<AscApiKeyRole>("Select a role for the generated API key", [
      { value: "ADMIN", label: "ADMIN (default)" },
      { value: "APP_MANAGER", label: "APP_MANAGER (least privilege for app management)" },
    ]);
    yield* Console.log("Creating an App Store Connect API key via your Apple ID...");
    return yield* generateAndUploadAscApiKeyViaAppleId(ctx.api, {
      context: auth.buildRequestContext(session),
      appleTeamIdentifier: session.teamId,
      nickname: defaultAscApiKeyNickname(),
      role,
    });
  });

const createIosAscKeyViaAppleId = (ctx: WizardContext) =>
  Effect.gen(function* () {
    const created = yield* generateAscKeyViaAppleId(ctx);
    yield* Console.log(`Created and stored ASC API key ${created.keyId}.`);
    yield* printKeyValue([
      ["ID", created.id],
      ["Key ID", created.keyId],
      ["Issuer ID", created.issuerId],
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

const uploadNewAscKey = (ctx: WizardContext) =>
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
    yield* Console.log(`ASC API key ${keyId} uploaded.`);
    return created.id;
  });

const setupProjectAscApiKey = (ctx: WizardContext) =>
  Effect.gen(function* () {
    const keys = yield* ctx.api.ascApiKeys.list();
    const baseChoices = [
      {
        value: "generate" as const,
        label: "Create a new ASC API key from your Apple ID (no .p8 needed)",
      },
      { value: "upload" as const, label: "Upload an existing .p8 key" },
    ];
    const choice =
      keys.items.length === 0
        ? yield* promptSelect<"generate" | "upload" | "existing">(
            "How would you like to set up the ASC key?",
            baseChoices,
          )
        : yield* promptSelect<"generate" | "upload" | "existing">(
            "How would you like to set up the ASC key?",
            [
              {
                value: "existing",
                label: `Use an existing ASC API key (${String(keys.items.length)})`,
              },
              ...baseChoices,
            ],
          );
    const config = yield* promptForBundleConfig(ctx);
    const ascKeyId = yield* Effect.gen(function* () {
      if (choice === "generate") {
        return (yield* generateAscKeyViaAppleId(ctx)).id;
      }
      if (choice === "upload") {
        return yield* uploadNewAscKey(ctx);
      }
      return yield* promptSelect<string>(
        "Select an ASC API key to bind",
        keys.items.map((key) => ({ value: key.id, label: `${key.name} (${key.keyId})` })),
      );
    });
    yield* ctx.api.iosBundleConfigurations.update({
      path: { id: config.id },
      payload: { ascApiKeyId: ascKeyId },
    });
    yield* Console.log(
      `ASC API key set up: ${ascKeyId} bound to ${config.bundleIdentifier} (${config.distributionType}).`,
    );
    return undefined;
  });

export const iosAscKeysMenu = (ctx: WizardContext): MenuEffect =>
  Effect.gen(function* () {
    yield* announce("iOS > App Store Connect API Key");
    const choice = yield* safePrompt(
      promptSelect<string>("What do you want to do?", [
        { value: "setup", label: "Set up your project to use an ASC API Key" },
        { value: "create", label: "Create a new ASC API key from your Apple ID (no .p8 needed)" },
        { value: "upload", label: "Add a new ASC API key" },
        { value: "bind", label: "Use an existing ASC API key" },
        { value: "delete", label: "Delete an ASC API key" },
        { value: BACK, label: "Go back" },
      ]),
    );
    if (choice === BACK) {
      return;
    }
    if (choice === "setup") {
      yield* safely("set up ASC key", setupProjectAscApiKey(ctx));
    } else if (choice === "create") {
      yield* safely("create ASC key", createIosAscKeyViaAppleId(ctx));
    } else if (choice === "upload") {
      yield* safely("upload ASC key", uploadIosAscKey(ctx));
    } else if (choice === "bind") {
      yield* safely("bind ASC key", bindIosAscKey(ctx));
    } else if (choice === "delete") {
      yield* safely("delete ASC key", pickAndDelete(ctx, "asc-api-key", "ASC API key"));
    }
    yield* iosAscKeysMenu(ctx);
  });
