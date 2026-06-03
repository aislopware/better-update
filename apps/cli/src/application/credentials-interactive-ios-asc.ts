import { Console, Effect } from "effect";

import { IOS_DISTRIBUTION_TO_TYPE } from "../lib/credentials-downloader";
import {
  generateAndUploadDistributionCertificate,
  generateAndUploadProvisioningProfile,
  listAppleCertificates,
  revokeAppleCertificate,
} from "../lib/credentials-generator";
import { MissingCredentialsError } from "../lib/exit-codes";
import { upsertIosBundleConfiguration } from "../lib/ios-bundle-config-upsert";
import { promptConfirm, promptMultiSelect, promptSelect } from "../lib/prompts";

import type { IosDistribution } from "../lib/build-profile";
import type { ApiClient } from "../services/api-client";

export interface IosSetupInput {
  readonly projectId: string;
  readonly bundleIdentifier: string;
  readonly distribution: IosDistribution;
}

export type DistributionTypeValue =
  (typeof IOS_DISTRIBUTION_TO_TYPE)[keyof typeof IOS_DISTRIBUTION_TO_TYPE];

export interface IosSetupContext {
  readonly certId: string;
  readonly cert: { readonly appleTeamId: string };
  readonly ascKeyId: string;
  readonly distributionType: DistributionTypeValue;
}

const interactiveCertLimitRecover = (api: ApiClient, ascApiKeyId: string) =>
  Effect.gen(function* () {
    yield* Console.log("");
    yield* Console.log(
      "Apple reports the certificate limit was hit (max 3 distribution certs per team).",
    );
    const certs = yield* listAppleCertificates(api, {
      ascApiKeyId,
      certificateType: "IOS_DISTRIBUTION",
    });
    if (certs.length === 0) {
      return yield* new MissingCredentialsError({
        message:
          "Apple says the certificate limit is hit but no existing certificates were returned.",
        hint: "Try again later or check the Apple Developer portal.",
      });
    }
    const toRevoke = yield* promptMultiSelect<string>(
      "Select one or more certificates to revoke before retrying",
      certs.map((entry) => ({
        value: entry.id,
        label: `${entry.serialNumber.slice(0, 12)}… (${entry.displayName ?? entry.certificateType}, exp ${entry.expirationDate.slice(0, 10)})`,
      })),
      { required: true },
    );
    yield* Effect.forEach(
      toRevoke,
      (id) => revokeAppleCertificate(api, { ascApiKeyId, developerPortalIdentifier: id }),
      { concurrency: "inherit" },
    );
    yield* Console.log(`Revoked ${toRevoke.length} certificate(s); retrying generation...`);
    return undefined;
  });

const generateDistributionCertInteractive = (api: ApiClient) =>
  Effect.gen(function* () {
    const ascKeys = yield* api.ascApiKeys.list();
    const teamAscKeys = ascKeys.items.filter((key) => key.appleTeamId !== null);
    if (teamAscKeys.length === 0) {
      return yield* new MissingCredentialsError({
        message: "No ASC API key linked to an Apple team in this organization.",
        hint: "Upload an ASC API key with a team assignment via the dashboard, then retry.",
      });
    }
    const ascKeyId = yield* promptSelect<string>(
      "Select an ASC API key to issue the certificate against",
      teamAscKeys.map((key) => ({ value: key.id, label: `${key.name} (${key.keyId})` })),
    );
    yield* Console.log("Generating CSR and requesting certificate from Apple...");
    const generate = generateAndUploadDistributionCertificate(api, { ascApiKeyId: ascKeyId });
    return yield* generate.pipe(
      Effect.catchTag("CertificateLimitError", () =>
        interactiveCertLimitRecover(api, ascKeyId).pipe(Effect.flatMap(() => generate)),
      ),
    );
  });

const chooseIosCertificateId = (api: ApiClient) =>
  Effect.gen(function* () {
    const certs = yield* api.appleDistributionCertificates.list();
    if (certs.items.length === 0) {
      yield* Console.log("No distribution certificate found in this organization.");
      const choice = yield* promptSelect<"generate" | "abort">("How would you like to proceed?", [
        { value: "generate", label: "Generate a new distribution certificate" },
        { value: "abort", label: "Abort — I'll upload one manually" },
      ]);
      if (choice === "abort") {
        return yield* new MissingCredentialsError({
          message: "Build aborted — no distribution certificate available.",
          hint: "Run `better-update credentials generate distribution-certificate --asc-key-id <id>` or upload via the dashboard.",
        });
      }
      const created = yield* generateDistributionCertInteractive(api);
      return created.id;
    }
    const choice = yield* promptSelect<string>(
      "Select a distribution certificate (or 'generate' for a fresh one)",
      [
        { value: "__generate__", label: "Generate a new distribution certificate" },
        ...certs.items.map((cert) => ({
          value: cert.id,
          label: `${cert.serialNumber.slice(0, 12)}… (team ${cert.appleTeamId})`,
        })),
      ],
    );
    if (choice === "__generate__") {
      const created = yield* generateDistributionCertInteractive(api);
      return created.id;
    }
    return choice;
  });

export const pickIosCertificate = (api: ApiClient) =>
  Effect.gen(function* () {
    const chosenId = yield* chooseIosCertificateId(api);
    const refreshed = yield* api.appleDistributionCertificates.list();
    const cert = refreshed.items.find((entry) => entry.id === chosenId);
    if (cert === undefined) {
      return yield* new MissingCredentialsError({
        message: "Selected certificate not found after generation.",
        hint: "Retry.",
      });
    }
    return { certId: chosenId, cert };
  });

export const pickIosAscKey = (api: ApiClient, appleTeamId: string) =>
  Effect.gen(function* () {
    const ascKeys = yield* api.ascApiKeys.list();
    const teamAscKeys = ascKeys.items.filter(
      (key) => key.appleTeamId !== null && key.appleTeamId === appleTeamId,
    );
    if (teamAscKeys.length === 0) {
      return yield* new MissingCredentialsError({
        message: `No ASC API key linked to Apple team ${appleTeamId}.`,
        hint: "Upload an ASC API key for that team via the dashboard, then retry.",
      });
    }
    return yield* promptSelect<string>(
      "Select an ASC API key",
      teamAscKeys.map((key) => ({ value: key.id, label: `${key.name} (${key.keyId})` })),
    );
  });

const generateProvisioningProfileForBundle = (
  api: ApiClient,
  input: IosSetupInput,
  ctx: IosSetupContext,
) =>
  Effect.gen(function* () {
    yield* Console.log("Generating provisioning profile via App Store Connect API...");
    const generated = yield* generateAndUploadProvisioningProfile(api, {
      ascApiKeyId: ctx.ascKeyId,
      distributionCertificateId: ctx.certId,
      bundleIdentifier: input.bundleIdentifier,
      distributionType: ctx.distributionType,
    });
    return generated.id;
  });

export const resolveIosProfileId = (api: ApiClient, input: IosSetupInput, ctx: IosSetupContext) =>
  Effect.gen(function* () {
    const profiles = yield* api.appleProvisioningProfiles.list({ urlParams: {} });
    const matching = profiles.items.filter(
      (profile) =>
        profile.bundleIdentifier === input.bundleIdentifier &&
        profile.distributionType === ctx.distributionType &&
        profile.appleTeamId === ctx.cert.appleTeamId,
    );
    if (matching.length === 0) {
      return yield* generateProvisioningProfileForBundle(api, input, ctx);
    }
    const useExisting = yield* promptConfirm(
      `Reuse an existing ${input.distribution} profile for ${input.bundleIdentifier}?`,
      { initialValue: true },
    );
    if (!useExisting) {
      return yield* generateProvisioningProfileForBundle(api, input, ctx);
    }
    return yield* promptSelect<string>(
      "Select a provisioning profile",
      matching.map((profile) => ({
        value: profile.id,
        label: profile.profileName ?? profile.developerPortalIdentifier ?? profile.id,
      })),
    );
  });

export const setupIosViaAscKey = (api: ApiClient, input: IosSetupInput) =>
  Effect.gen(function* () {
    const { certId, cert } = yield* pickIosCertificate(api);
    const ascKeyId = yield* pickIosAscKey(api, cert.appleTeamId);
    const distributionType = IOS_DISTRIBUTION_TO_TYPE[input.distribution];
    const ctx: IosSetupContext = { certId, cert, ascKeyId, distributionType };
    const profileId = yield* resolveIosProfileId(api, input, ctx);

    yield* upsertIosBundleConfiguration(api, {
      projectId: input.projectId,
      bundleIdentifier: input.bundleIdentifier,
      distributionType,
      appleTeamId: cert.appleTeamId,
      appleDistributionCertificateId: certId,
      appleProvisioningProfileId: profileId,
      ascApiKeyId: ascKeyId,
    });
    return undefined;
  });
