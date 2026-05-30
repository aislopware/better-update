import path from "node:path";
import process from "node:process";

import { fromBase64 } from "@better-update/encoding";
import { FileSystem } from "@effect/platform";
import { Console, Effect } from "effect";

import { requireSecretString } from "../lib/credential-secret";
import { generateAndUploadKeystore } from "../lib/credentials-generator";
import { uploadCredential } from "../lib/credentials-manager";
import { IdentityError, MissingCredentialsError } from "../lib/exit-codes";
import { printHuman, printKeyValue } from "../lib/output";
import { readAppMetaOptional, readProjectId } from "../lib/project-link";
import { promptPassword, promptSelect, promptText } from "../lib/prompts";
import { CliRuntime } from "../services/cli-runtime";
import { openFromDownload, openVaultSessionInteractive } from "./credential-cipher";
import { ensureAndroidCredentials } from "./credentials-interactive";
import { announce, BACK, pickAndDelete, safely, safePrompt } from "./credentials-manager-shared";
import { rebindAndroidKeystore, showAndroidBinding } from "./credentials-rebind";

import type { MenuEffect, WizardContext } from "./credentials-manager-shared";

/** Read a required string field from a decrypted keystore secret. */
const keystoreField = (secret: Record<string, unknown>, key: string) =>
  requireSecretString(
    secret,
    key,
    (field) => new IdentityError({ message: `Decrypted keystore is missing "${field}".` }),
  );

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

const downloadAndroidKeystoreInteractive = (ctx: WizardContext) =>
  Effect.gen(function* () {
    const list = yield* ctx.api.androidUploadKeystores.list();
    if (list.items.length === 0) {
      return yield* Console.log("No keystores to download.");
    }
    const id = yield* promptSelect<string>(
      "Select a keystore to download",
      list.items.map((item) => ({
        value: item.id,
        label: `${item.keyAlias} (${item.id.slice(0, 8)}…)`,
      })),
    );
    const data = yield* ctx.api.androidUploadKeystores.download({ path: { id } });
    const session = yield* openVaultSessionInteractive(ctx.api);
    const secret = yield* openFromDownload({
      session,
      credentialType: "keystore",
      downloaded: data,
    });
    const keystoreBase64 = yield* keystoreField(secret, "keystoreBase64");
    const keystorePassword = yield* keystoreField(secret, "keystorePassword");
    const keyPassword = yield* keystoreField(secret, "keyPassword");
    const defaultPath = path.join(process.cwd(), `${data.id}.keystore`);
    const rawTarget = yield* promptText("Output path", { defaultValue: defaultPath });
    const target = rawTarget.trim().length === 0 ? defaultPath : rawTarget;
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFile(target, fromBase64(keystoreBase64));
    yield* Console.log("Keystore downloaded.");
    yield* printKeyValue([
      ["Path", target],
      ["Key alias", data.keyAlias],
      ["Keystore password", keystorePassword],
      ["Key password", keyPassword],
    ]);
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

const resolveAndroidPackageForBinding = (ctx: WizardContext) =>
  Effect.gen(function* () {
    if (ctx.androidPackage !== undefined) {
      return ctx.androidPackage;
    }
    const runtime = yield* CliRuntime;
    const cwd = yield* runtime.cwd;
    const meta = yield* readAppMetaOptional(cwd, "android");
    return (
      meta.androidPackage ?? (yield* promptText("Android application identifier (package name)"))
    );
  });

const findDefaultAndroidGroup = (ctx: WizardContext) =>
  Effect.gen(function* () {
    const projectId = ctx.projectId.length > 0 ? ctx.projectId : yield* readProjectId;
    const applicationIdentifier = yield* resolveAndroidPackageForBinding(ctx);
    const apps = yield* ctx.api.androidApplicationIdentifiers.list({
      path: { projectId },
    });
    const app = apps.items.find((entry) => entry.packageName === applicationIdentifier);
    if (app === undefined) {
      return yield* new MissingCredentialsError({
        message: `No Android build credentials registered for ${applicationIdentifier}.`,
        hint: "Run 'Keystore > Set up keystore for this app' first.",
      });
    }
    const groups = yield* ctx.api.androidBuildCredentials.list({
      path: { applicationIdentifierId: app.id },
    });
    const group = groups.items.find((entry) => entry.isDefault) ?? groups.items.at(0);
    if (group === undefined) {
      return yield* new MissingCredentialsError({
        message: `No default Android build credentials group for ${applicationIdentifier}.`,
        hint: "Run 'Keystore > Set up keystore for this app' first.",
      });
    }
    return { applicationIdentifier, group } as const;
  });

const bindFcmV1Gsa = (ctx: WizardContext) =>
  Effect.gen(function* () {
    const keys = yield* ctx.api.googleServiceAccountKeys.list();
    if (keys.items.length === 0) {
      return yield* new MissingCredentialsError({
        message: "No Google service account keys uploaded yet.",
        hint: "Run 'Upload a Google service account JSON key' first.",
      });
    }
    const { applicationIdentifier, group } = yield* findDefaultAndroidGroup(ctx);
    const gsaKeyId = yield* promptSelect<string>(
      "Select a GSA key to bind for FCM V1 push notifications",
      keys.items.map((key) => ({
        value: key.id,
        label: `${key.clientEmail} (${key.id.slice(0, 8)}…)`,
      })),
    );
    yield* ctx.api.androidBuildCredentials.update({
      path: { id: group.id },
      payload: { googleServiceAccountKeyForFcmV1Id: gsaKeyId },
    });
    yield* Console.log(
      `Bound GSA key ${gsaKeyId.slice(0, 8)}… to ${applicationIdentifier} for FCM V1 push.`,
    );
    yield* printKeyValue([
      ["Application", applicationIdentifier],
      ["Group", group.name],
      ["FCM V1 GSA key", gsaKeyId],
    ]);
    return undefined;
  });

const unbindFcmV1Gsa = (ctx: WizardContext) =>
  Effect.gen(function* () {
    const { applicationIdentifier, group } = yield* findDefaultAndroidGroup(ctx);
    if (group.googleServiceAccountKeyForFcmV1Id === null) {
      return yield* Console.log(`No FCM V1 GSA key bound to ${applicationIdentifier}.`);
    }
    yield* ctx.api.androidBuildCredentials.update({
      path: { id: group.id },
      payload: { googleServiceAccountKeyForFcmV1Id: null },
    });
    yield* Console.log(`Unbound FCM V1 GSA key from ${applicationIdentifier}.`);
    return undefined;
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
      yield* safely("download keystore", downloadAndroidKeystoreInteractive(ctx));
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
        { value: "bind-fcm", label: "Set up GSA key for FCM V1 push notifications" },
        { value: "unbind-fcm", label: "Unbind GSA key from FCM V1 push notifications" },
        { value: "delete", label: "Delete a Google service account key" },
        { value: BACK, label: "Go back" },
      ]),
    );
    if (choice === BACK) {
      return;
    }
    if (choice === "upload") {
      yield* safely("upload GSA", uploadAndroidGsa(ctx));
    } else if (choice === "bind-fcm") {
      yield* safely("bind FCM V1 GSA", bindFcmV1Gsa(ctx));
    } else if (choice === "unbind-fcm") {
      yield* safely("unbind FCM V1 GSA", unbindFcmV1Gsa(ctx));
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
