import path from "node:path";

import { Prompt } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import { Console, Effect, Redacted } from "effect";

import type * as Terminal from "@effect/platform/Terminal";

import { generateAndroidKeystore, promptAndroidKeystoreDetails } from "../../lib/android-keystore";
import { authenticateWithApple } from "../../lib/apple-auth";
import { autoProvisionIosCredentials } from "../../lib/apple-provisioner";
import {
  findActiveCredential,
  uploadAndActivateCredential,
  uploadAndActivateCredentialFromBlob,
} from "../../lib/credentials-manager";
import { CliRuntime } from "../../services/cli-runtime";

import type { IosDistribution } from "../../lib/build-profile";
import type { ApiClient } from "../../services/api-client";

const resolvePromptPath = (homeDirectory: string, value: string): string => {
  const trimmed = value.trim();
  return path.resolve(
    trimmed.startsWith("~/") ? path.join(homeDirectory, trimmed.slice(2)) : trimmed,
  );
};

const validateFilePath =
  (homeDirectory: string, extensions: ReadonlyArray<string>) => (value: string) =>
    Effect.gen(function* () {
      const resolved = resolvePromptPath(homeDirectory, value);
      const fs = yield* FileSystem.FileSystem;

      if (!extensions.some((extension) => resolved.toLowerCase().endsWith(extension))) {
        return yield* Effect.fail(`Expected a file ending in ${extensions.join(" or ")}.`);
      }

      const exists = yield* fs.exists(resolved);
      if (!exists) {
        return yield* Effect.fail(`File not found: ${resolved}`);
      }

      return resolved;
    }).pipe(
      Effect.mapError((cause) =>
        typeof cause === "string" ? cause : `Failed to inspect file path: ${String(cause)}`,
      ),
    );

const validateRequiredText = (label: string) => (value: string) =>
  value.trim().length > 0 ? Effect.succeed(value.trim()) : Effect.fail(`${label} is required.`);

const promptExistingFilePath = (params: {
  readonly message: string;
  readonly extensions: ReadonlyArray<string>;
}): Effect.Effect<
  string,
  Terminal.QuitException,
  CliRuntime | FileSystem.FileSystem | Terminal.Terminal
> =>
  Effect.gen(function* () {
    const runtime = yield* CliRuntime;
    const homeDirectory = yield* runtime.homeDirectory;
    const rawPath = yield* Prompt.text({
      message: params.message,
    });

    return yield* validateFilePath(
      homeDirectory,
      params.extensions,
    )(rawPath).pipe(
      Effect.catchAll((message) =>
        Console.error(message).pipe(Effect.zipRight(promptExistingFilePath(params))),
      ),
    );
  });

const promptName = (message: string, defaultValue: string) =>
  Prompt.text({
    message,
    default: defaultValue,
    validate: validateRequiredText("Credential name"),
  });

const promptPassword = (message: string) =>
  Prompt.password({
    message,
  }).pipe(Effect.map(Redacted.value));

const uploadIosCertificate = (api: ApiClient, projectId: string) =>
  Effect.gen(function* () {
    const filePath = yield* promptExistingFilePath({
      message: "Distribution certificate path (.p12):",
      extensions: [".p12"],
    });
    const password = yield* promptPassword("Certificate password (leave blank if none):");
    const name = yield* promptName("Certificate name:", path.basename(filePath));

    const credential = yield* uploadAndActivateCredential(api, {
      projectId,
      platform: "ios",
      type: "distribution-certificate",
      name,
      filePath,
      password,
    });

    yield* Console.log(`Uploaded iOS distribution certificate: ${credential.name}`);
  });

const uploadIosProvisioningProfile = (
  api: ApiClient,
  projectId: string,
  distribution: IosDistribution,
) =>
  Effect.gen(function* () {
    const filePath = yield* promptExistingFilePath({
      message: "Provisioning profile path (.mobileprovision):",
      extensions: [".mobileprovision"],
    });
    const name = yield* promptName("Provisioning profile name:", path.basename(filePath));

    const credential = yield* uploadAndActivateCredential(api, {
      projectId,
      platform: "ios",
      type: "provisioning-profile",
      distribution,
      name,
      filePath,
    });

    yield* Console.log(`Uploaded iOS provisioning profile: ${credential.name}`);
  });

const uploadExistingAndroidKeystore = (api: ApiClient, projectId: string) =>
  Effect.gen(function* () {
    const filePath = yield* promptExistingFilePath({
      message: "Keystore path (.jks or .keystore):",
      extensions: [".jks", ".keystore"],
    });
    const password = yield* promptPassword("Keystore password:");
    const keyAlias = yield* Prompt.text({
      message: "Key alias:",
      validate: validateRequiredText("Key alias"),
    });
    const keyPassword = yield* promptPassword(
      "Key password (leave blank to reuse keystore password):",
    ).pipe(Effect.map((value) => (value.trim().length > 0 ? value : password)));
    const name = yield* promptName("Keystore name:", path.basename(filePath));

    const credential = yield* uploadAndActivateCredential(api, {
      projectId,
      platform: "android",
      type: "keystore",
      name,
      filePath,
      password,
      keyAlias,
      keyPassword,
    });

    yield* Console.log(`Uploaded Android keystore: ${credential.name}`);
  });

const generateAndUploadAndroidKeystore = (api: ApiClient, projectId: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "better-update-keystore-" });
    const details = yield* promptAndroidKeystoreDetails();
    const outputPath = path.join(tempDir, "release.keystore");

    yield* generateAndroidKeystore({
      outputPath,
      keyAlias: details.keyAlias,
      storePassword: details.storePassword,
      keyPassword: details.keyPassword,
      commonName: details.commonName,
      organization: details.organization,
    });

    const credential = yield* uploadAndActivateCredential(api, {
      projectId,
      platform: "android",
      type: "keystore",
      name: details.credentialName,
      filePath: outputPath,
      password: details.storePassword,
      keyAlias: details.keyAlias,
      keyPassword: details.keyPassword,
    });

    yield* Console.log(`Generated and uploaded Android keystore: ${credential.name}`);
  });

export const provisionIosCredentials = (params: {
  readonly api: ApiClient;
  readonly projectId: string;
  readonly distribution: IosDistribution;
  readonly bundleIdentifier: string;
  readonly appName: string;
}) =>
  Effect.gen(function* () {
    const [activeCertificate, activeProfile] = yield* Effect.all(
      [
        findActiveCredential(params.api, {
          projectId: params.projectId,
          platform: "ios",
          type: "distribution-certificate",
        }),
        findActiveCredential(params.api, {
          projectId: params.projectId,
          platform: "ios",
          type: "provisioning-profile",
          distribution: params.distribution,
        }),
      ],
      { concurrency: 2 },
    );

    if (activeCertificate && activeProfile) {
      yield* Console.log("");
      yield* Console.log("Active iOS credentials already exist. Retrying the build with them.");
      return;
    }

    yield* Console.log("");
    if (!activeCertificate) {
      yield* Console.log("No active iOS distribution certificate found.");
    }
    if (!activeProfile) {
      yield* Console.log(`No active iOS provisioning profile found for "${params.distribution}".`);
    }

    const method = yield* Prompt.select({
      message: "How would you like to set up iOS credentials?",
      choices: [
        {
          title: "Upload existing files",
          value: "upload" as const,
          description: "Provide .p12 certificate and .mobileprovision files you already have.",
        },
        {
          title: "Auto-provision via Apple Developer Portal",
          value: "auto" as const,
          description: "Log in to Apple and create credentials automatically.",
        },
      ],
    });

    if (method === "upload") {
      if (!activeCertificate) {
        yield* uploadIosCertificate(params.api, params.projectId);
      }
      if (!activeProfile) {
        yield* uploadIosProvisioningProfile(params.api, params.projectId, params.distribution);
      }
      return;
    }

    // Auto-provision path.
    const authContext = yield* authenticateWithApple;
    const result = yield* autoProvisionIosCredentials({
      authContext,
      bundleIdentifier: params.bundleIdentifier,
      distribution: params.distribution,
      appName: params.appName,
    });

    yield* uploadAndActivateCredentialFromBlob(params.api, {
      projectId: params.projectId,
      platform: "ios",
      type: "distribution-certificate",
      name: "Apple Distribution (auto-provisioned)",
      blob: result.certificate.p12Base64,
      password: result.certificate.p12Password,
    });

    yield* uploadAndActivateCredentialFromBlob(params.api, {
      projectId: params.projectId,
      platform: "ios",
      type: "provisioning-profile",
      distribution: params.distribution,
      name: result.profile.name,
      blob: result.profile.contentBase64,
    });

    yield* Console.log("iOS credentials uploaded to Better Update server.");
  });

export const provisionAndroidCredentials = (params: {
  readonly api: ApiClient;
  readonly projectId: string;
}) =>
  Effect.gen(function* () {
    yield* Console.log("");
    yield* Console.log("No usable Android keystore found for this project.");

    const method = yield* Prompt.select({
      message: "How would you like to provide a keystore?",
      choices: [
        {
          title: "Upload an existing keystore",
          value: "upload" as const,
          description: "Use a .jks or .keystore file you already manage.",
        },
        {
          title: "Generate a new keystore",
          value: "generate" as const,
          description: "Create a new upload keystore locally, then upload it.",
        },
      ],
    });

    if (method === "upload") {
      yield* uploadExistingAndroidKeystore(params.api, params.projectId);
      return;
    }

    yield* generateAndUploadAndroidKeystore(params.api, params.projectId);
  });
