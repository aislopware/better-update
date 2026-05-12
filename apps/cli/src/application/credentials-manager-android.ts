import { Console, Effect } from "effect";

import { generateAndUploadKeystore } from "../lib/credentials-generator";
import { uploadCredential } from "../lib/credentials-manager";
import { printHuman, printKeyValue } from "../lib/output";
import { promptPassword, promptSelect, promptText } from "../lib/prompts";
import { ensureAndroidCredentials } from "./credentials-interactive";
import { announce, BACK, pickAndDelete, safely, safePrompt } from "./credentials-manager-shared";
import { rebindAndroidKeystore, showAndroidBinding } from "./credentials-rebind";

import type { MenuEffect, WizardContext } from "./credentials-manager-shared";

const setupAndroidProjectCredentials = (ctx: WizardContext) =>
  Effect.gen(function* () {
    const applicationIdentifier =
      ctx.androidPackage ?? (yield* promptText("Android application identifier"));
    yield* ensureAndroidCredentials(
      ctx.api,
      { projectId: ctx.projectId, applicationIdentifier },
      { freezeCredentials: false },
    );
    yield* Console.log("");
    yield* showAndroidBinding(ctx.api, { projectId: ctx.projectId, applicationIdentifier });
  });

const generateAndroidKeystoreInteractive = (ctx: WizardContext) =>
  Effect.gen(function* () {
    const alias = yield* promptText("Key alias", { placeholder: "upload-key" });
    const storePassword = yield* promptPassword("Keystore password");
    const keyPassword = yield* promptPassword("Key password");
    const commonName = yield* promptText("Common name (CN)", { placeholder: "Your App" });
    const organization = yield* promptText("Organization (O)", { placeholder: "Your Company" });
    yield* Console.log("Generating keystore with keytool...");
    const created = yield* generateAndUploadKeystore(ctx.api, {
      keyAlias: alias,
      storePassword,
      keyPassword,
      commonName,
      organization,
    });
    yield* Console.log("Keystore generated and uploaded.");
    yield* printKeyValue([
      ["ID", created.id],
      ["Alias", created.keyAlias],
    ]);
  });

const uploadAndroidKeystoreInteractive = (ctx: WizardContext) =>
  Effect.gen(function* () {
    const filePath = yield* promptText("Path to the keystore (.jks/.keystore) file");
    const keyAlias = yield* promptText("Key alias");
    const storePassword = yield* promptPassword("Keystore password");
    const keyPassword = yield* promptPassword("Key password");
    const created = yield* uploadCredential(ctx.api, {
      platform: "android",
      type: "keystore",
      name: keyAlias,
      filePath,
      keyAlias,
      keyPassword,
      password: storePassword,
    });
    yield* Console.log("Keystore uploaded.");
    yield* printKeyValue([
      ["ID", created.id],
      ["Alias", keyAlias],
    ]);
  });

const changeDefaultKeystore = (ctx: WizardContext) =>
  Effect.gen(function* () {
    const applicationIdentifier =
      ctx.androidPackage ?? (yield* promptText("Android application identifier"));
    yield* rebindAndroidKeystore(ctx.api, {
      projectId: ctx.projectId,
      applicationIdentifier,
    });
    yield* showAndroidBinding(ctx.api, { projectId: ctx.projectId, applicationIdentifier });
  });

const downloadAndroidKeystoreHint = (ctx: WizardContext) =>
  Effect.gen(function* () {
    const list = yield* ctx.api.androidUploadKeystores.list();
    if (list.items.length === 0) {
      return yield* Console.log("No keystores to download.");
    }
    yield* printHuman(
      "Run: `better-update credentials download --type keystore --id <id>` for the file-aware flow.",
    );
    yield* printHuman("Available keystores:");
    for (const item of list.items) {
      yield* Console.log(`  ${item.id}  alias=${item.keyAlias}`);
    }
    return undefined;
  });

const uploadAndroidGsa = (ctx: WizardContext) =>
  Effect.gen(function* () {
    const filePath = yield* promptText("Path to the Google service account JSON file");
    const created = yield* uploadCredential(ctx.api, {
      platform: "android",
      type: "google-service-account-key",
      name: filePath,
      filePath,
    });
    yield* Console.log("Google service account key uploaded.");
    yield* printKeyValue([["ID", created.id]]);
  });

const androidKeystoreMenu = (ctx: WizardContext): MenuEffect =>
  Effect.gen(function* () {
    yield* announce("Android > Keystore");
    const choice = yield* safePrompt(
      promptSelect<string>("What do you want to do?", [
        { value: "setup", label: "Set up keystore for this app (auto-generate or pick)" },
        { value: "generate", label: "Generate a new keystore" },
        { value: "upload", label: "Upload an existing keystore" },
        { value: "rebind", label: "Change the default keystore" },
        { value: "download", label: "Download a keystore" },
        { value: "delete", label: "Delete a keystore" },
        { value: BACK, label: "Go back" },
      ]),
    );
    if (choice === BACK) {
      return;
    }
    if (choice === "setup") {
      yield* safely("setup", setupAndroidProjectCredentials(ctx));
    } else if (choice === "generate") {
      yield* safely("generate keystore", generateAndroidKeystoreInteractive(ctx));
    } else if (choice === "upload") {
      yield* safely("upload keystore", uploadAndroidKeystoreInteractive(ctx));
    } else if (choice === "rebind") {
      yield* safely("rebind keystore", changeDefaultKeystore(ctx));
    } else if (choice === "download") {
      yield* safely("download keystore", downloadAndroidKeystoreHint(ctx));
    } else if (choice === "delete") {
      yield* safely("delete keystore", pickAndDelete(ctx, "keystore", "keystore"));
    }
    yield* androidKeystoreMenu(ctx);
  });

const androidGsaMenu = (ctx: WizardContext): MenuEffect =>
  Effect.gen(function* () {
    yield* announce("Android > Google Service Account");
    const choice = yield* safePrompt(
      promptSelect<string>("What do you want to do?", [
        { value: "upload", label: "Upload a Google service account JSON key" },
        { value: "delete", label: "Delete a Google service account key" },
        { value: BACK, label: "Go back" },
      ]),
    );
    if (choice === BACK) {
      return;
    }
    if (choice === "upload") {
      yield* safely("upload GSA", uploadAndroidGsa(ctx));
    } else if (choice === "delete") {
      yield* safely(
        "delete GSA",
        pickAndDelete(ctx, "google-service-account-key", "Google service account key"),
      );
    }
    yield* androidGsaMenu(ctx);
  });

const credentialsJsonMenuAndroid = (): MenuEffect =>
  Effect.gen(function* () {
    yield* announce("Android > credentials.json");
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
    yield* credentialsJsonMenuAndroid();
  });

export const androidMenu = (ctx: WizardContext): MenuEffect =>
  Effect.gen(function* () {
    yield* announce("Android");
    const choice = yield* safePrompt(
      promptSelect<string>("What do you want to manage?", [
        { value: "keystore", label: "Keystore" },
        { value: "gsa", label: "Google Service Account (FCM V1)" },
        { value: "json", label: "credentials.json (sync push/pull)" },
        { value: BACK, label: "Go back" },
      ]),
    );
    if (choice === BACK) {
      return;
    }
    if (choice === "keystore") {
      yield* androidKeystoreMenu(ctx);
    } else if (choice === "gsa") {
      yield* androidGsaMenu(ctx);
    } else if (choice === "json") {
      yield* credentialsJsonMenuAndroid();
    }
    yield* androidMenu(ctx);
  });
