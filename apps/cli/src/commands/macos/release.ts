import { DEFAULT_DESKTOP_CHANNEL, DesktopReleaseChannel } from "@better-update/api";
import { compact } from "@better-update/type-guards";
import { FileSystem, Effect, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";

import type { DesktopRelease } from "@better-update/api";

import {
  createMacosRelease,
  macosFeedUrls,
  resolveReleaseBuild,
} from "../../application/macos-release";
import {
  SPARKLE_PRIVATE_KEY_ENV,
  TAURI_KEY_PASSWORD_ENV,
  TAURI_PRIVATE_KEY_ENV,
} from "../../application/macos-release-keys";
import { parseRolloutPercentage } from "../../lib/cli-schemas";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { printHuman, printHumanKeyValue, printTable } from "../../lib/output";
import { optionalArgument, optionalFlag, positiveIntFlag } from "../../lib/params";
import { readProjectId } from "../../lib/project-link";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { ConfigStore } from "../../services/config-store";

const channelFlag = Flag.String("channel").pipe(Flag.withSchema(DesktopReleaseChannel));

/** Sparkle phasing interval; `0` turns phasing off. */
const PhasedRolloutHoursInput = Schema.NumberFromString.check(
  Schema.isInt({ message: "Expected a whole number of hours" }),
  Schema.isBetween({ minimum: 0, maximum: 720 }, { message: "Expected 0-720 hours" }),
);

const phasedRolloutFlag = (description: string) =>
  Flag.String("phased-rollout-hours").pipe(
    Flag.withSchema(PhasedRolloutHoursInput),
    Flag.withDescription(description),
    optionalFlag,
  );

const PHASING_HELP =
  "Sparkle phased rollout: 1 of 7 client groups more every this many hours (critical updates and manual checks skip it; electron-updater ignores it)";

const releaseState = (release: DesktopRelease): string => {
  if (release.halted) {
    return "halted";
  }
  const reach =
    release.rolloutPercentage === 100 ? "live" : `${String(release.rolloutPercentage)}%`;
  return release.phasedRolloutHours === null
    ? reach
    : `${reach}, phased every ${String(release.phasedRolloutHours)}h`;
};

const readNotes = (notes: string | undefined, notesFile: string | undefined) =>
  Effect.gen(function* () {
    if (notesFile === undefined) {
      return notes;
    }
    if (notes !== undefined) {
      return yield* new InvalidArgumentError({
        message: "Pass --notes or --notes-file, not both.",
      });
    }
    return yield* (yield* FileSystem.FileSystem).readFileString(notesFile).pipe(
      Effect.mapError(
        (cause) =>
          new InvalidArgumentError({
            message: `Could not read --notes-file "${notesFile}": ${String(cause)}`,
          }),
      ),
    );
  });

const createCommand = Command.make(
  "create",
  {
    buildId: optionalArgument(
      Argument.String("buildId").pipe(
        Argument.withDescription("Build to release (default: the newest Developer ID build)"),
      ),
    ),
    channel: channelFlag.pipe(
      Flag.withDescription(
        `Feed channel (default: ${DEFAULT_DESKTOP_CHANNEL}, what every client sees; others are opt-in)`,
      ),
      Flag.withDefault(DEFAULT_DESKTOP_CHANNEL),
    ),
    notes: Flag.String("notes").pipe(
      Flag.withDescription("Release notes shown in the update prompt"),
      optionalFlag,
    ),
    "notes-file": Flag.String("notes-file").pipe(
      Flag.withDescription("Read the release notes from a file"),
      optionalFlag,
    ),
    critical: Flag.Boolean("critical").pipe(
      Flag.withDescription("Mark as a critical update (Sparkle sparkle:criticalUpdate)"),
      Flag.withDefault(false),
    ),
    rollout: Flag.String("rollout").pipe(
      Flag.withDescription("Percentage of installs offered the release (1-100, default 100)"),
      optionalFlag,
    ),
    "phased-rollout-hours": phasedRolloutFlag(`${PHASING_HELP} (default: off)`),
    file: Flag.String("file").pipe(
      Flag.withDescription(
        "Local copy of the build's artifact to hash and sign instead of downloading it (must match the upload)",
      ),
      optionalFlag,
    ),
    "sparkle-key-file": Flag.String("sparkle-key-file").pipe(
      Flag.withDescription(
        `Sparkle EdDSA private key exported with \`generate_keys -x\` (default: $${SPARKLE_PRIVATE_KEY_ENV})`,
      ),
      optionalFlag,
    ),
    "tauri-key-file": Flag.String("tauri-key-file").pipe(
      Flag.withDescription(
        `Tauri updater private key from \`tauri signer generate\`, for a tar.gz build (default: $${TAURI_PRIVATE_KEY_ENV}; password: $${TAURI_KEY_PASSWORD_ENV})`,
      ),
      optionalFlag,
    ),
    environment: Flag.String("environment").pipe(
      Flag.withDescription(
        `Read ${SPARKLE_PRIVATE_KEY_ENV} / ${TAURI_PRIVATE_KEY_ENV} / ${TAURI_KEY_PASSWORD_ENV} from this environment's variables when no key file or env var is set`,
      ),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
      const projectId = yield* readProjectId;
      const api = yield* apiClient;
      const rolloutPercentage =
        args.rollout === undefined
          ? undefined
          : yield* parseRolloutPercentage(args.rollout, "rollout");
      const releaseNotes = yield* readNotes(args.notes, args["notes-file"]);
      const build = yield* resolveReleaseBuild(api, { projectId, buildId: args.buildId });
      const release = yield* createMacosRelease(api, {
        projectId,
        build,
        channel: args.channel,
        releaseNotes: releaseNotes?.trim() === "" ? undefined : releaseNotes?.trim(),
        critical: args.critical,
        rolloutPercentage,
        phasedRolloutHours: args["phased-rollout-hours"] || undefined,
        file: args.file,
        sparkleKeyFile: args["sparkle-key-file"],
        tauriKeyFile: args["tauri-key-file"],
        environment: args.environment,
      });
      const feeds = macosFeedUrls(
        yield* (yield* ConfigStore).getBaseUrl,
        projectId,
        release.channel,
      );
      yield* printHumanKeyValue([
        ["Release", release.id],
        ["Build", release.buildId],
        ["Channel", release.channel],
        ["Version", `${release.appVersion ?? "-"} (${release.buildNumber ?? "-"})`],
        ["Rollout", releaseState(release)],
        ["Sparkle signature", release.sparkleSigned ? "signed" : "none"],
        ...(release.artifactFormat === "tar.gz"
          ? [["Tauri signature", release.tauriSigned ? "signed" : "none"] as const]
          : []),
        ["Sparkle appcast", feeds.appcast],
        ...(release.artifactFormat === "zip"
          ? ([
              ["electron-updater feed", feeds.electron],
              ["Differential updates", release.blockmap ? "blockmap uploaded" : "none"],
            ] as const)
          : []),
        ...(release.artifactFormat === "tar.gz" && release.tauriSigned
          ? [["Tauri updater endpoint", feeds.tauri] as const]
          : []),
      ]);
      return release;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Publish a macOS Developer ID build to the project's update feeds (Sparkle appcast, electron-updater, Tauri updater), hashing and signing the stored artifact",
  ),
);

const listCommand = Command.make(
  "list",
  {
    channel: channelFlag.pipe(Flag.withDescription("Only this channel"), optionalFlag),
    limit: positiveIntFlag("limit", { description: "Max rows", defaultValue: 20 }),
  },
  Effect.fn(function* (args) {
    const projectId = yield* readProjectId;
    const api = yield* apiClient;
    const { items } = yield* api.desktopReleases.list({
      params: { projectId },
      query: { limit: args.limit, ...compact({ channel: args.channel }) },
    });
    yield* printTable(
      ["ID", "Channel", "Version", "Build", "Format", "State", "Signed", "Created"],
      items.map((release) => [
        release.id,
        release.channel,
        release.appVersion ?? "-",
        release.buildNumber ?? "-",
        release.artifactFormat,
        releaseState(release),
        [release.sparkleSigned ? "sparkle" : "", release.tauriSigned ? "tauri" : ""]
          .filter((name) => name !== "")
          .join("+") || "no",
        release.createdAt,
      ]),
    );
    const feeds = macosFeedUrls(
      yield* (yield* ConfigStore).getBaseUrl,
      projectId,
      args.channel ?? DEFAULT_DESKTOP_CHANNEL,
    );
    yield* printHuman(
      `\nSparkle appcast: ${feeds.appcast}\nelectron-updater: ${feeds.electron}\nTauri updater: ${feeds.tauri}`,
    );
  }, runCommand()),
).pipe(Command.withDescription("List the project's macOS update-feed releases, newest first"));

const releaseIdArgument = Argument.String("releaseId").pipe(
  Argument.withDescription("Release ID (from `macos release list`)"),
);

const haltCommand = Command.make(
  "halt",
  { releaseId: releaseIdArgument },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      const release = yield* api.desktopReleases.update({
        params: { id: args.releaseId },
        payload: { halted: true },
      });
      yield* printHuman(
        `Release ${release.id} halted: the feeds stop offering it; Macs that installed it keep it.`,
      );
      return release;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Stop offering a release in the update feeds"));

const resumeCommand = Command.make(
  "resume",
  { releaseId: releaseIdArgument },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      const release = yield* api.desktopReleases.update({
        params: { id: args.releaseId },
        payload: { halted: false },
      });
      yield* printHuman(`Release ${release.id} is offered again (${releaseState(release)}).`);
      return release;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Offer a halted release in the update feeds again"));

const rolloutCommand = Command.make(
  "rollout",
  {
    releaseId: releaseIdArgument,
    percentage: Flag.String("percentage").pipe(
      Flag.withDescription("Percentage of installs offered the release (1-100)"),
      optionalFlag,
    ),
    "phased-rollout-hours": phasedRolloutFlag(`${PHASING_HELP}; 0 turns it off`),
  },
  Effect.fn(
    function* (args) {
      const phasedHours = args["phased-rollout-hours"];
      if (args.percentage === undefined && phasedHours === undefined) {
        return yield* new InvalidArgumentError({
          message: "Pass --percentage, --phased-rollout-hours, or both.",
        });
      }
      const rolloutPercentage =
        args.percentage === undefined
          ? undefined
          : yield* parseRolloutPercentage(args.percentage, "percentage");
      const api = yield* apiClient;
      const release = yield* api.desktopReleases.update({
        params: { id: args.releaseId },
        payload: {
          ...compact({ rolloutPercentage }),
          ...(phasedHours === undefined ? {} : { phasedRolloutHours: phasedHours || null }),
        },
      });
      yield* printHuman(`Release ${release.id} is now ${releaseState(release)}.`);
      return release;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Change the share of installs a release is offered to, or its Sparkle phasing",
  ),
);

const deleteCommand = Command.make(
  "delete",
  { releaseId: releaseIdArgument },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      yield* api.desktopReleases.delete({ params: { id: args.releaseId } });
      yield* printHuman(`Release ${args.releaseId} deleted; the build itself is kept.`);
      return { id: args.releaseId, deleted: true };
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Remove a release from the update feeds (keeps the build)"));

export const releaseCommand = Command.make("release").pipe(
  Command.withDescription(
    "Publish macOS Developer ID builds to Sparkle / electron-updater / Tauri feeds with staged rollout",
  ),
  Command.withSubcommands([
    createCommand,
    listCommand,
    haltCommand,
    resumeCommand,
    rolloutCommand,
    deleteCommand,
  ]),
);
