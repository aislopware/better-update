/**
 * The macOS branch of the interactive credentials manager.
 *
 * macOS certificates hang off the org, not off a bundle configuration: nothing
 * binds them to a project the way an iOS certificate binds to an iOS bundle
 * configuration, and `macos sign` resolves the Developer ID Application one at
 * signing time. So this menu is management only — store, inspect, issue, drop —
 * with no binding step.
 */
import { Console, Effect } from "effect";

import {
  APPLE_CERTIFICATE_TYPE_LABELS,
  isMacosCertificateType,
} from "../lib/apple-certificate-type";
import { isoDate } from "../lib/credential-choices";
import {
  ascKeyRequestContext,
  generateAndUploadDistributionCertificate,
} from "../lib/credentials-generator-apple";
import { uploadCredential } from "../lib/credentials-manager";
import { MissingCredentialsError } from "../lib/exit-codes";
import { printHumanTable, printKeyValue } from "../lib/output";
import { promptPassword, promptSelect, promptText } from "../lib/prompts";
import { announce, BACK, pickAndDelete, safely, safePrompt } from "./credentials-manager-shared";

import type { AppleCertificateType } from "../lib/apple-certificate-type";
import type { MenuEffect, WizardContext } from "./credentials-manager-shared";

// Developer ID Installer is absent on purpose: App Store Connect exposes no
// creation path for it, so it can only be uploaded.
const GENERATABLE_MACOS_TYPES = [
  "DEVELOPER_ID_APPLICATION",
  "MAC_APP_DISTRIBUTION",
  "MAC_INSTALLER_DISTRIBUTION",
  "MAC_APP_DEVELOPMENT",
] as const satisfies readonly AppleCertificateType[];

const listMacosCertificates = (ctx: WizardContext) =>
  Effect.gen(function* () {
    const { items } = yield* ctx.api.appleDistributionCertificates.list();
    const macos = items.filter((cert) => isMacosCertificateType(cert.certificateType));
    if (macos.length === 0) {
      return yield* Console.log("No macOS certificates stored yet.");
    }
    return yield* printHumanTable(
      ["ID", "Kind", "Serial", "Apple team", "Expires"],
      macos.map((cert) => [
        cert.id,
        APPLE_CERTIFICATE_TYPE_LABELS[cert.certificateType],
        cert.serialNumber,
        cert.appleTeamId,
        isoDate(cert.validUntil),
      ]),
    );
  });

const uploadMacosCertificate = (ctx: WizardContext) =>
  Effect.gen(function* () {
    const filePath = yield* promptText("Path to the .p12 file");
    const password = yield* promptPassword(".p12 password");
    const name = yield* promptText("Display name (label shown in lists)", {
      placeholder: "Developer ID Application",
    });
    const created = yield* uploadCredential(ctx.api, {
      platform: "macos",
      type: "macos-certificate",
      name,
      filePath,
      password,
    });
    yield* Console.log("macOS certificate uploaded.");
    return yield* printKeyValue([
      ["ID", created.id],
      ["Type", created.type],
    ]);
  });

const generateMacosCertificate = (ctx: WizardContext) =>
  Effect.gen(function* () {
    const ascKeys = yield* ctx.api.ascApiKeys.list();
    const teamKeys = ascKeys.items.filter((entry) => entry.appleTeamId !== null);
    if (teamKeys.length === 0) {
      return yield* new MissingCredentialsError({
        message: "No ASC API key linked to an Apple team.",
        hint: "Upload an ASC API key first (iOS > App Store Connect API Key > Upload).",
      });
    }
    const certificateType = yield* promptSelect<(typeof GENERATABLE_MACOS_TYPES)[number]>(
      "Certificate kind",
      GENERATABLE_MACOS_TYPES.map((value) => ({
        value,
        label: APPLE_CERTIFICATE_TYPE_LABELS[value],
      })),
    );
    const ascKeyId = yield* promptSelect<string>(
      "ASC API key to issue against",
      teamKeys.map((key) => ({ value: key.id, label: `${key.name} (${key.keyId})` })),
    );
    yield* Console.log("Requesting the certificate from Apple...");
    const context = yield* ascKeyRequestContext(ctx.api, ascKeyId);
    const created = yield* generateAndUploadDistributionCertificate(ctx.api, {
      context,
      certificateType,
    });
    yield* Console.log("macOS certificate generated.");
    return yield* printKeyValue([
      ["ID", created.id],
      ["Certificate type", created.certificateType],
      ["Serial", created.serialNumber],
      ["Apple team", created.appleTeamIdentifier],
    ]);
  });

export const macosMenu = (ctx: WizardContext): MenuEffect =>
  Effect.gen(function* () {
    yield* announce("macOS > Certificates");
    const choice = yield* safePrompt(
      promptSelect<string>("What do you want to do?", [
        { value: "list", label: "List stored macOS certificates" },
        { value: "upload", label: "Upload a .p12 you exported from Keychain Access" },
        { value: "generate", label: "Issue a new certificate from Apple" },
        { value: "delete", label: "Delete a macOS certificate (local only)" },
        { value: BACK, label: "Go back" },
      ]),
    );
    if (choice === BACK) {
      return;
    }
    if (choice === "list") {
      yield* safely("list macOS certificates", listMacosCertificates(ctx));
    } else if (choice === "upload") {
      yield* safely("upload macOS certificate", uploadMacosCertificate(ctx));
    } else if (choice === "generate") {
      yield* safely("generate macOS certificate", generateMacosCertificate(ctx));
    } else if (choice === "delete") {
      yield* safely(
        "delete macOS certificate",
        pickAndDelete(ctx, "macos-certificate", "macOS certificate"),
      );
    }
    yield* macosMenu(ctx);
  });
