import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  normalizePlatform,
  normalizeReleaseType,
  openAscSession,
} from "../../../application/app-store-connect";
import { resolveBuildId, setVersion } from "../../../application/app-store-versions";
import { runEffect } from "../../../lib/citty-effect";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman, printHumanKeyValue } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

interface VersionSetArgs extends AscCommonArgs {
  readonly platform?: string | undefined;
  readonly build?: string | undefined;
  readonly "build-version"?: string | undefined;
  readonly version?: string | undefined;
  readonly "release-type"?: string | undefined;
  readonly "earliest-release-date"?: string | undefined;
}

export const versionSetCommand = defineCommand({
  meta: {
    name: "set",
    description:
      "Configure the editable App Store version: attach a build, set the version string, release type, or scheduled date",
  },
  args: {
    ...ASC_COMMON_ARGS,
    platform: {
      type: "string",
      default: "ios",
      description: "Platform: ios (default), mac, tv, vision",
    },
    build: { type: "string", description: "ASC build id to attach to the version" },
    "build-version": {
      type: "string",
      description: "Attach the uploaded build with this CFBundleVersion (build number)",
    },
    version: { type: "string", description: "Rename the editable version to this version string" },
    "release-type": {
      type: "string",
      description: "Release type: AFTER_APPROVAL, MANUAL, or SCHEDULED",
    },
    "earliest-release-date": {
      type: "string",
      description: "ISO 8601 date for a SCHEDULED release, e.g. 2026-07-01T09:00:00-07:00",
    },
  },
  run: async ({ args }: { readonly args: VersionSetArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const releaseType = yield* normalizeReleaseType(args["release-type"]);
        const hasBuild = args.build !== undefined || args["build-version"] !== undefined;
        if (
          !hasBuild &&
          args.version === undefined &&
          releaseType === undefined &&
          args["earliest-release-date"] === undefined
        ) {
          return yield* new InvalidArgumentError({
            message:
              "Nothing to set. Pass at least one of --build, --build-version, --version, --release-type, --earliest-release-date.",
          });
        }
        const platform = yield* normalizePlatform(args.platform);
        const session = yield* openAscSession(args);
        const buildId = hasBuild
          ? yield* resolveBuildId(session.ctx, session.appId, {
              buildId: args.build,
              buildVersion: args["build-version"],
            })
          : undefined;
        const version = yield* setVersion(session.ctx, session.appId, platform, {
          ...compact({
            buildId,
            versionString: args.version,
            releaseType,
            earliestReleaseDate: args["earliest-release-date"],
          }),
        });
        yield* printHuman(`Updated App Store version ${version.versionString} (${version.state}).`);
        yield* printHumanKeyValue([
          ["Version", version.versionString],
          ["Platform", version.platform],
          ["State", version.state],
          ["ID", version.id],
        ]);
        return version;
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
