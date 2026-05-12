import { Console, Effect } from "effect";

import { uploadCredential } from "../lib/credentials-manager";
import { MissingCredentialsError } from "../lib/exit-codes";
import { printKeyValue } from "../lib/output";
import { promptSelect, promptText } from "../lib/prompts";
import {
  announce,
  BACK,
  pickAndDelete,
  promptForBundleConfig,
  safely,
  safePrompt,
} from "./credentials-manager-shared";

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
    const choice =
      keys.items.length === 0
        ? "upload"
        : yield* promptSelect<"upload" | "existing">("How would you like to set up the ASC key?", [
            {
              value: "existing",
              label: `Use an existing ASC API key (${String(keys.items.length)})`,
            },
            { value: "upload", label: "Upload a new ASC API key" },
          ]);
    const config = yield* promptForBundleConfig(ctx);
    const ascKeyId =
      choice === "upload"
        ? yield* uploadNewAscKey(ctx)
        : yield* promptSelect<string>(
            "Select an ASC API key to bind",
            keys.items.map((key) => ({ value: key.id, label: `${key.name} (${key.keyId})` })),
          );
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
    } else if (choice === "upload") {
      yield* safely("upload ASC key", uploadIosAscKey(ctx));
    } else if (choice === "bind") {
      yield* safely("bind ASC key", bindIosAscKey(ctx));
    } else if (choice === "delete") {
      yield* safely("delete ASC key", pickAndDelete(ctx, "asc-api-key", "ASC API key"));
    }
    yield* iosAscKeysMenu(ctx);
  });
