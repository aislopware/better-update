import { Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";

import { readAppJson, readProjectId } from "../../lib/app-json";
import { authenticateWithApple } from "../../lib/apple-auth";
import { autoProvisionIosCredentials } from "../../lib/apple-provisioner";
import { readAppMeta } from "../../lib/build-profile";
import { uploadAndActivateCredentialFromBlob } from "../../lib/credentials-manager";
import { printKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";

import type { IosDistribution } from "../../lib/build-profile";

const distribution = Options.choice("distribution", [
  "app-store",
  "ad-hoc",
  "development",
  "enterprise",
] as const).pipe(Options.withDefault("ad-hoc" as IosDistribution));

const projectIdOption = Options.text("project-id").pipe(Options.optional);

export const generateIosCredentialsCommand = Command.make(
  "generate-ios",
  { distribution, projectIdOption },
  (opts) =>
    Effect.gen(function* () {
      const projectId = yield* Option.match(opts.projectIdOption, {
        onNone: () => readProjectId,
        onSome: (id) => Effect.succeed(id),
      });

      const appJson = yield* readAppJson;
      const appMeta = yield* readAppMeta(appJson, "ios");

      const bundleIdentifier = appMeta.bundleId;
      if (!bundleIdentifier) {
        yield* Console.error("Missing expo.ios.bundleIdentifier in app.json.");
        return;
      }

      const expo = appJson["expo"] as Record<string, unknown> | undefined;
      const appName = typeof expo?.["name"] === "string" ? expo["name"] : bundleIdentifier;

      // Authenticate with Apple.
      const authContext = yield* authenticateWithApple;

      // Auto-provision certificate + profile.
      const result = yield* autoProvisionIosCredentials({
        authContext,
        bundleIdentifier,
        distribution: opts.distribution,
        appName,
      });

      // Upload to Better Update server.
      const api = yield* apiClient;

      const cert = yield* uploadAndActivateCredentialFromBlob(api, {
        projectId,
        platform: "ios",
        type: "distribution-certificate",
        name: "Apple Distribution (auto-provisioned)",
        blob: result.certificate.p12Base64,
        password: result.certificate.p12Password,
      });

      const prof = yield* uploadAndActivateCredentialFromBlob(api, {
        projectId,
        platform: "ios",
        type: "provisioning-profile",
        distribution: opts.distribution,
        name: result.profile.name,
        blob: result.profile.contentBase64,
      });

      yield* Console.log("");
      yield* Console.log("iOS credentials generated, uploaded, and activated.");
      yield* Console.log("");
      yield* printKeyValue([
        ["Certificate ID", cert.id],
        ["Certificate Serial", result.certificate.serialNumber],
        ["Profile ID", prof.id],
        ["Profile Name", result.profile.name],
        ["Distribution", opts.distribution],
        ["Bundle ID", bundleIdentifier],
      ]);
    }),
);
