import { compact } from "@better-update/type-guards";
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  ASC_PLATFORM_FLAG,
  normalizePlatform,
  normalizeReleaseType,
  openAscSession,
} from "../../../application/app-store-connect";
import { resolveBuildId, setVersion } from "../../../application/app-store-versions";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman, printHumanKeyValue } from "../../../lib/output";
import { optionalFlag } from "../../../lib/params";
import { runCommand } from "../../../lib/run-command";

export const versionSetCommand = Command.make(
  "set",
  {
    ...ASC_COMMON_ARGS,
    platform: ASC_PLATFORM_FLAG,
    build: Flag.String("build").pipe(
      Flag.withDescription("ASC build id to attach to the version"),
      optionalFlag,
    ),
    "build-version": Flag.String("build-version").pipe(
      Flag.withDescription("Attach the uploaded build with this CFBundleVersion (build number)"),
      optionalFlag,
    ),
    version: Flag.String("version").pipe(
      Flag.withDescription("Rename the editable version to this version string"),
      optionalFlag,
    ),
    "release-type": Flag.String("release-type").pipe(
      Flag.withDescription("Release type: AFTER_APPROVAL, MANUAL, or SCHEDULED"),
      optionalFlag,
    ),
    "earliest-release-date": Flag.String("earliest-release-date").pipe(
      Flag.withDescription("ISO 8601 date for a SCHEDULED release, e.g. 2026-07-01T09:00:00-07:00"),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Configure the editable App Store version: attach a build, set the version string, release type, or scheduled date",
  ),
);
