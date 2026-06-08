import { Console, Effect } from "effect";

import type { RequestContext } from "@expo/apple-utils";

import { IOS_DISTRIBUTION_TO_TYPE } from "../lib/credentials-downloader";
import {
  AppleIdGenerateFailedError,
  generateAndUploadApnsKeyViaAppleId,
  generateAndUploadDistributionCertificateViaAppleId,
  generateAndUploadProvisioningProfileViaAppleId,
  listApnsKeysViaAppleId,
  listDistributionCertsViaAppleId,
  revokeApnsKeyViaAppleId,
  revokeDistributionCertViaAppleId,
} from "../lib/credentials-generator-apple-id";
import { CredentialValidationError } from "../lib/exit-codes";
import { upsertIosBundleConfiguration } from "../lib/ios-bundle-config-upsert";
import { promptMultiSelect, promptSelect } from "../lib/prompts";
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

const interactiveAppleIdCertLimitRecover = (ctx: RequestContext) =>
  Effect.gen(function* () {
    yield* Console.log("");
    yield* Console.log(
      "Apple reports the certificate limit was hit (max 3 distribution certs per team).",
    );
    const certs = yield* listDistributionCertsViaAppleId(ctx, "IOS_DISTRIBUTION");
    if (certs.length === 0) {
      return yield* new AppleIdGenerateFailedError({
        step: "limit-recover",
        message:
          "Apple says the certificate limit is hit but no existing certificates were returned.",
      });
    }
    const toRevoke = yield* promptMultiSelect<string>(
      "Select one or more certificates to revoke before retrying",
      certs.map((entry) => ({
        value: entry.developerPortalIdentifier,
        label: `${entry.serialNumber.slice(0, 12)}… (${entry.displayName}, exp ${entry.expirationDate.slice(0, 10)})`,
      })),
      { required: true },
    );
    yield* Effect.forEach(toRevoke, (id) => revokeDistributionCertViaAppleId(ctx, id), {
      concurrency: "inherit",
    });
    yield* Console.log(`Revoked ${toRevoke.length} certificate(s); retrying generation...`);
    return undefined;
  });

// ── APNs push keys via Apple ID ──────────────────────────────────

export const defaultApnsKeyName = () =>
  `better-update APNs (${new Date().toISOString().slice(0, 10)})`;

// Apple caps a team at two APNs keys. On a create-limit hit, let the user revoke
// existing keys and retry (mirrors interactiveAppleIdCertLimitRecover).
const apnsKeyLimitRecover = (ctx: RequestContext) =>
  Effect.gen(function* () {
    yield* Console.log("");
    yield* Console.log("Apple reports the APNs key limit was hit (max 2 keys per team).");
    const keys = yield* listApnsKeysViaAppleId(ctx);
    const revocable = keys.filter((entry) => entry.canRevoke);
    if (revocable.length === 0) {
      return yield* new CredentialValidationError({
        message: "Apple says the APNs key limit is hit but no revocable keys were returned.",
      });
    }
    const toRevoke = yield* promptMultiSelect<string>(
      "Select one or more APNs keys to revoke before retrying",
      revocable.map((entry) => ({
        value: entry.developerPortalKeyId,
        label: `${entry.name} (${entry.developerPortalKeyId})`,
      })),
      { required: true },
    );
    yield* Effect.forEach(toRevoke, (id) => revokeApnsKeyViaAppleId(ctx, id), {
      concurrency: "inherit",
    });
    yield* Console.log(`Revoked ${toRevoke.length} key(s); retrying creation...`);
    return undefined;
  });

/**
 * Log in with Apple ID, create a fresh APNs `.p8` on the portal, download it, and
 * upload it end-to-end encrypted — recovering interactively from the key limit.
 * Returns the stored credential; callers render their own success output. Shared
 * by the `generate push-key` command and the interactive wizard.
 */
export const createApnsKeyViaAppleId = (api: ApiClient, name: string) =>
  Effect.gen(function* () {
    const auth = yield* AppleAuth;
    const session = yield* auth.ensureLoggedIn();
    const ctx = auth.buildRequestContext(session);
    const generate = generateAndUploadApnsKeyViaAppleId(api, {
      context: ctx,
      appleTeamIdentifier: session.teamId,
      name,
    });
    return yield* generate.pipe(
      Effect.catchTag("ApnsKeyLimitError", () =>
        apnsKeyLimitRecover(ctx).pipe(Effect.flatMap(() => generate)),
      ),
    );
  });

const generateDistributionCertViaAppleIdInteractive = (api: ApiClient, ctx: RequestContext) =>
  Effect.gen(function* () {
    yield* Console.log("Generating distribution certificate via Apple ID...");
    const generate = generateAndUploadDistributionCertificateViaAppleId(api, { context: ctx });
    return yield* generate.pipe(
      Effect.catchTag("CertificateLimitError", () =>
        interactiveAppleIdCertLimitRecover(ctx).pipe(Effect.flatMap(() => generate)),
      ),
    );
  });

const GENERATE_NEW = "__generate__";

const chooseDistributionCertViaAppleId = (
  api: ApiClient,
  ctx: RequestContext,
  appleTeamIdentifier: string,
) =>
  Effect.gen(function* () {
    const [teams, all] = yield* Effect.all(
      [api.appleTeams.list(), api.appleDistributionCertificates.list()],
      { concurrency: 2 },
    );
    const team = teams.items.find((entry) => entry.appleTeamId === appleTeamIdentifier);
    const items =
      team === undefined ? [] : all.items.filter((cert) => cert.appleTeamId === team.id);
    if (items.length === 0) {
      const created = yield* generateDistributionCertViaAppleIdInteractive(api, ctx);
      return { id: created.id, appleTeamId: created.appleTeamId };
    }
    const choice = yield* promptSelect<string>(
      "Select a distribution certificate (or 'generate' for a fresh one)",
      [
        { value: GENERATE_NEW, label: "Generate a new distribution certificate" },
        ...items.map((cert) => ({
          value: cert.id,
          label: `${cert.serialNumber.slice(0, 12)}… (team ${appleTeamIdentifier})`,
        })),
      ],
    );
    if (choice === GENERATE_NEW) {
      const created = yield* generateDistributionCertViaAppleIdInteractive(api, ctx);
      return { id: created.id, appleTeamId: created.appleTeamId };
    }
    const cert = items.find((entry) => entry.id === choice);
    if (cert === undefined) {
      return yield* new AppleIdGenerateFailedError({
        step: "pick-certificate",
        message: `Selected certificate ${choice} not found after listing`,
      });
    }
    return { id: cert.id, appleTeamId: cert.appleTeamId };
  });

export const setupIosViaAppleId = (api: ApiClient, input: AppleIdIosSetupInput) =>
  Effect.gen(function* () {
    const auth = yield* AppleAuth;
    const session = yield* auth.ensureLoggedIn();
    const ctx = auth.buildRequestContext(session);
    yield* Console.log(
      `Logged in as ${session.username}. Team: ${session.teamName ?? session.teamId} (${session.teamId}).`,
    );
    const cert = yield* chooseDistributionCertViaAppleId(api, ctx, session.teamId);
    const distributionType = IOS_DISTRIBUTION_TO_TYPE[input.distribution];
    yield* Console.log("Generating provisioning profile via Apple ID...");
    const profile = yield* generateAndUploadProvisioningProfileViaAppleId(api, {
      context: ctx,
      distributionCertificateId: cert.id,
      bundleIdentifier: input.bundleIdentifier,
      distributionType,
    });
    // ascApiKeyId omitted — Apple ID setups don't bind an ASC key. Existing
    // bindings (if any) are preserved by the upsert.
    yield* upsertIosBundleConfiguration(api, {
      projectId: input.projectId,
      bundleIdentifier: input.bundleIdentifier,
      distributionType,
      appleTeamId: cert.appleTeamId,
      appleDistributionCertificateId: cert.id,
      appleProvisioningProfileId: profile.id,
    });
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
