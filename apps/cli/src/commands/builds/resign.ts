import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { fromBase64 } from "@better-update/encoding";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printHuman } from "../../lib/output";
import { apiClient } from "../../services/api-client";

import type { ApiClient } from "../../services/api-client";

interface ResolvedInputs {
  readonly profilePath: string;
  readonly signingIdentity: string;
  readonly appName: string;
}

const resignWorkflowText = (params: {
  buildId: string;
  installLink: string;
  resolved: ResolvedInputs | undefined;
}) => {
  const inputs = params.resolved;
  const profilePathHint =
    inputs === undefined ? "/path/to/new.mobileprovision" : inputs.profilePath;
  const identityHint =
    inputs === undefined
      ? `"iPhone Distribution: Your Team (ABCDE12345)"`
      : `"${inputs.signingIdentity}"`;
  const appName = inputs === undefined ? "YourApp.app" : `${inputs.appName}.app`;

  const resolvedHeader =
    inputs === undefined
      ? ""
      : `Resolved inputs
  Profile: ${inputs.profilePath}
  Identity: ${inputs.signingIdentity}
  Target app bundle: ${inputs.appName}.app

`;

  return `Resigning iOS build ${params.buildId}
=================================================

iOS code-signing requires native macOS tooling (codesign, security, xcodebuild)
and the matching distribution certificate in your Keychain. better-update does
not bundle that toolchain — instead it gives you the inputs and a re-upload
path.

${resolvedHeader}Step 1 — Download the existing IPA
  ${params.installLink}

Step 2 — Resign the IPA locally with your new provisioning profile.
  Pick one of:
  a) fastlane sigh resign:
       fastlane sigh resign /tmp/build.ipa \\
         --signing_identity ${identityHint} \\
         --provisioning_profile ${profilePathHint}

  b) Apple's codesign + xcodebuild:
       unzip /tmp/build.ipa -d /tmp/payload
       cp ${profilePathHint} /tmp/payload/Payload/${appName}/embedded.mobileprovision
       codesign -f -s ${identityHint} \\
         --entitlements <(security cms -D -i ${profilePathHint}) \\
         /tmp/payload/Payload/${appName}
       (cd /tmp/payload && zip -qr /tmp/resigned.ipa Payload)

Step 3 — Upload the re-signed IPA as a fresh build:
  better-update builds upload --platform ios --profile <profile> \\
    --artifact /tmp/resigned.ipa --project <projectId>

The new build will get a fresh build ID. The original build remains for
rollback. Disable or delete it when the re-signed build is verified.
`;
};

const downloadProfileToTmp = (api: ApiClient, profileId: string) =>
  Effect.gen(function* () {
    const data = yield* api.appleProvisioningProfiles.download({ path: { id: profileId } });
    const target = path.join(tmpdir(), `better-update-resign-${data.id}.mobileprovision`);
    yield* Effect.promise(async () => writeFile(target, fromBase64(data.profileBase64)));
    return {
      profilePath: target,
      profileName: data.profileName,
      bundleIdentifier: data.bundleIdentifier,
    };
  });

const resolveSigningIdentity = (api: ApiClient, certId: string) =>
  Effect.gen(function* () {
    const cert = yield* api.appleDistributionCertificates.download({ path: { id: certId } });
    return `iPhone Distribution: ${cert.appleTeamIdentifier}`;
  });

export const resignCommand = defineCommand({
  meta: {
    name: "resign",
    description:
      "Print step-by-step instructions for re-signing an iOS build with a new provisioning profile",
  },
  args: {
    build: { type: "string", required: true, description: "Source build ID" },
    "profile-id": {
      type: "string",
      description:
        "Provisioning profile ID to bind to the resigned build (downloads it to a tmp path)",
    },
    "cert-id": {
      type: "string",
      description: "Distribution certificate ID to derive the codesign --signing-identity from",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const build = yield* api.builds.get({ path: { id: args.build } });
        if (build.platform !== "ios") {
          yield* printHuman(
            `Build ${args.build} is ${build.platform}. Re-signing this command currently covers iOS only.`,
          );
          process.exitCode = 2;
          return undefined;
        }
        const link = yield* api.builds.getInstallLink({ path: { id: args.build } });

        // @effect-diagnostics-next-line effect/effectSucceedWithVoid:off -- undefined is a load-bearing success value (unifies with downloadProfileToTmp's result to {...} | undefined); Effect.void breaks the === undefined / ?.profilePath downstream
        const profilePromise =
          args["profile-id"] === undefined
            ? Effect.succeed(undefined)
            : downloadProfileToTmp(api, args["profile-id"]);
        // @effect-diagnostics-next-line effect/effectSucceedWithVoid:off -- undefined is a load-bearing success value (unifies with resolveSigningIdentity's string to string | undefined); Effect.void breaks the === undefined / ?? downstream
        const identityPromise =
          args["cert-id"] === undefined
            ? Effect.succeed(undefined)
            : resolveSigningIdentity(api, args["cert-id"]);

        const [profile, identity] = yield* Effect.all([profilePromise, identityPromise], {
          concurrency: 2,
        });

        const resolved: ResolvedInputs | undefined =
          profile === undefined && identity === undefined
            ? undefined
            : {
                profilePath: profile?.profilePath ?? "/path/to/new.mobileprovision",
                signingIdentity: identity ?? "iPhone Distribution: Your Team (ABCDE12345)",
                appName: profile?.bundleIdentifier.split(".").pop() ?? "YourApp",
              };

        yield* printHuman(
          resignWorkflowText({
            buildId: args.build,
            installLink: link.artifactUrl,
            resolved,
          }),
        );
        return undefined;
      }),
    ),
});
