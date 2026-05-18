import { Console, Effect } from "effect";

import { IOS_DISTRIBUTION_TO_TYPE } from "../lib/credentials-downloader";
import {
  generateAndUploadDistributionCertificateViaAppleId,
  generateAndUploadProvisioningProfileViaAppleId,
} from "../lib/credentials-generator-apple-id";
import { promptSelect } from "../lib/prompts";
import { AppleAuth } from "../services/apple-auth";

import type { IosDistribution } from "../lib/build-profile";
import type { ApiClient } from "../services/api-client";

export interface AppleIdIosSetupInput {
  readonly projectId: string;
  readonly bundleIdentifier: string;
  readonly distribution: IosDistribution;
}

export type IosSetupPath = "apple-id" | "asc-key";

export const chooseIosSetupPath = (api: ApiClient) =>
  Effect.gen(function* () {
    const ascKeys = yield* api.ascApiKeys.list();
    const hasAscKeys = ascKeys.items.some((key) => key.appleTeamId !== null);
    if (!hasAscKeys) {
      // No ASC keys configured — Apple ID is the only option. Skip the prompt.
      return "apple-id" as IosSetupPath;
    }
    return yield* promptSelect<IosSetupPath>(
      "How would you like to provide your iOS credentials?",
      [
        { value: "apple-id", label: "Login with Apple ID (recommended for interactive use)" },
        { value: "asc-key", label: "Use an App Store Connect API key" },
      ],
    );
  });

export const setupIosViaAppleId = (api: ApiClient, input: AppleIdIosSetupInput) =>
  Effect.gen(function* () {
    const auth = yield* AppleAuth;
    const session = yield* auth.ensureLoggedIn();
    const ctx = auth.buildRequestContext(session);
    yield* Console.log(
      `Logged in as ${session.username}. Team: ${session.teamName ?? session.teamId} (${session.teamId}).`,
    );
    yield* Console.log("Generating distribution certificate via Apple ID...");
    const cert = yield* generateAndUploadDistributionCertificateViaAppleId(api, { context: ctx });
    const distributionType = IOS_DISTRIBUTION_TO_TYPE[input.distribution];
    yield* Console.log("Generating provisioning profile via Apple ID...");
    const profile = yield* generateAndUploadProvisioningProfileViaAppleId(api, {
      context: ctx,
      distributionCertificateId: cert.id,
      bundleIdentifier: input.bundleIdentifier,
      distributionType,
    });
    yield* api.iosBundleConfigurations.create({
      path: { projectId: input.projectId },
      payload: {
        bundleIdentifier: input.bundleIdentifier,
        distributionType,
        appleTeamId: cert.appleTeamId,
        appleDistributionCertificateId: cert.id,
        appleProvisioningProfileId: profile.id,
        // ascApiKeyId omitted — Apple ID setups don't bind an ASC key.
      },
    });
    yield* Console.log("iOS bundle configuration saved.");
    return undefined;
  });

export interface AppleIdRegenerateInput {
  readonly bundleIdentifier: string;
  readonly distributionCertificateId: string;
  readonly distributionType: "APP_STORE" | "AD_HOC" | "DEVELOPMENT" | "ENTERPRISE";
  readonly bundleConfigurationId: string;
}

export const regenerateProvisioningProfileViaAppleId = (
  api: ApiClient,
  input: AppleIdRegenerateInput,
) =>
  Effect.gen(function* () {
    const auth = yield* AppleAuth;
    const session = yield* auth.ensureLoggedIn();
    yield* Console.log("Regenerating provisioning profile via Apple ID...");
    const created = yield* generateAndUploadProvisioningProfileViaAppleId(api, {
      context: auth.buildRequestContext(session),
      distributionCertificateId: input.distributionCertificateId,
      bundleIdentifier: input.bundleIdentifier,
      distributionType: input.distributionType,
    });
    yield* api.iosBundleConfigurations.update({
      path: { id: input.bundleConfigurationId },
      payload: { appleProvisioningProfileId: created.id },
    });
    return created;
  });
