import process from "node:process";

import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printHuman } from "../../lib/output";
import { apiClient } from "../../services/api-client";

const resignWorkflowText = (buildId: string, installLink: string) =>
  `Resigning iOS build ${buildId}
=================================================

iOS code-signing requires native macOS tooling (codesign, security, xcodebuild)
and the matching distribution certificate in your Keychain. better-update does
not bundle that toolchain — instead it gives you the inputs and a re-upload
path.

Step 1 — Download the existing IPA
  ${installLink}

Step 2 — Resign the IPA locally with your new provisioning profile.
  Pick one of:
  a) fastlane sigh resign:
       fastlane sigh resign /tmp/build.ipa \\
         --signing_identity "iPhone Distribution: Your Team (ABCDE12345)" \\
         --provisioning_profile /path/to/new.mobileprovision

  b) Apple's codesign + xcodebuild:
       unzip /tmp/build.ipa -d /tmp/payload
       cp /path/to/new.mobileprovision /tmp/payload/Payload/YourApp.app/embedded.mobileprovision
       codesign -f -s "iPhone Distribution: Your Team (ABCDE12345)" \\
         --entitlements <(security cms -D -i /path/to/new.mobileprovision) \\
         /tmp/payload/Payload/YourApp.app
       (cd /tmp/payload && zip -qr /tmp/resigned.ipa Payload)

Step 3 — Upload the re-signed IPA as a fresh build:
  better-update builds upload --platform ios --profile <profile> \\
    --artifact /tmp/resigned.ipa --project <projectId>

The new build will get a fresh build ID. The original build remains for
rollback. Disable or delete it when the re-signed build is verified.
`;

export const resignCommand = defineCommand({
  meta: {
    name: "resign",
    description:
      "Print step-by-step instructions for re-signing an iOS build with a new provisioning profile",
  },
  args: {
    build: { type: "string", required: true, description: "Source build ID" },
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
        yield* printHuman(resignWorkflowText(args.build, link.artifactUrl));
        return undefined;
      }),
    ),
});
