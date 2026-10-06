/**
 * `<macos|windows|linux> release`: publish desktop builds to the project's
 * update feeds and steer them afterwards (staged rollout, halt, resume). One
 * implementation for the three platforms; each gets the flags its updaters
 * need — Sparkle on a Mac, WinSparkle on Windows, Tauri everywhere.
 */
import {
  DEFAULT_DESKTOP_CHANNEL,
  DesktopReleaseChannel,
  desktopFeedUrls,
} from "@better-update/api";
import { compact } from "@better-update/type-guards";
import { FileSystem, Effect, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";

import type { DesktopPlatform, DesktopRelease } from "@better-update/api";

import {
  PLATFORM_LABELS,
  createDesktopReleases,
  resolveReleaseBuilds,
} from "../../application/desktop-release";
import {
  SPARKLE_PRIVATE_KEY_ENV,
  TAURI_KEY_PASSWORD_ENV,
  TAURI_PRIVATE_KEY_ENV,
  WINSPARKLE_PRIVATE_KEY_ENV,
} from "../../application/desktop-release-keys";
import { parseRolloutPercentage } from "../../lib/cli-schemas";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { printHuman, printHumanKeyValue, printHumanTable, printTable } from "../../lib/output";
import { optionalFlag, positiveIntFlag } from "../../lib/params";
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

/** generate_appcast's `--maximum-deltas`; `0` makes none. */
const MaximumDeltasInput = Schema.NumberFromString.check(
  Schema.isInt({ message: "Expected a whole number" }),
  Schema.isBetween({ minimum: 0, maximum: 10 }, { message: "Expected 0-10" }),
);

const DEFAULT_MAXIMUM_DELTAS = 3;

const PHASING_HELP =
  "Sparkle phased rollout: 1 of 7 client groups more every this many hours (critical updates and manual checks skip it; electron-updater ignores it)";

/** The updaters each platform's feeds serve, for the descriptions. */
const UPDATERS: Record<DesktopPlatform, string> = {
  macos: "Sparkle appcast, electron-updater, Tauri updater",
  windows: "electron-updater (NSIS), WinSparkle appcast, Tauri updater",
  linux: "electron-updater (AppImage/deb/rpm), Tauri updater",
};

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

const signers = (release: DesktopRelease): string =>
  [
    release.sparkleSigned ? "sparkle" : "",
    release.winSparkleSigned ? "winsparkle" : "",
    release.tauriSigned ? "tauri" : "",
  ]
    .filter((name) => name !== "")
    .join("+") || "no";

/** How older versions update to it without the whole file: a blockmap, Sparkle deltas. */
const differential = (release: DesktopRelease): string =>
  [
    release.blockmap ? "blockmap" : "",
    release.sparkleDeltas > 0
      ? `${String(release.sparkleDeltas)} sparkle delta${release.sparkleDeltas === 1 ? "" : "s"}`
      : "",
  ]
    .filter((part) => part !== "")
    .join(", ") || "no";

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

const keyFileFlag = (name: string, description: string) =>
  Flag.String(name).pipe(Flag.withDescription(description), optionalFlag);

const SPARKLE_KEY_HELP = `Sparkle EdDSA private key exported with \`generate_keys -x\` (default: $${SPARKLE_PRIVATE_KEY_ENV}; macOS only)`;
const WINSPARKLE_KEY_HELP = `WinSparkle EdDSA private key from \`winsparkle-tool generate-key\` (default: $${WINSPARKLE_PRIVATE_KEY_ENV}; Windows only)`;
const TAURI_KEY_HELP = `Tauri updater private key from \`tauri signer generate\` (default: $${TAURI_PRIVATE_KEY_ENV}; password: $${TAURI_KEY_PASSWORD_ENV})`;

const printFeeds = (params: {
  readonly platform: DesktopPlatform;
  readonly projectId: string;
  readonly channel: string;
  readonly releases: readonly DesktopRelease[];
}) =>
  Effect.gen(function* () {
    const feeds = desktopFeedUrls({
      baseUrl: yield* (yield* ConfigStore).getBaseUrl,
      ...params,
    });
    yield* printHumanKeyValue(feeds.map((feed) => [feed.label, feed.url] as const));
  });

const createCommand = (platform: DesktopPlatform) =>
  Command.make(
    "create",
    {
      buildIds: Argument.String("buildId").pipe(
        Argument.withDescription(
          "Builds to release (default: every build of the newest version not yet on the channel)",
        ),
        Argument.variadic(),
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
          "Local copy of the build's artifact to hash and sign instead of downloading it (one build only; must match the upload)",
        ),
        optionalFlag,
      ),
      "sparkle-key-file": keyFileFlag("sparkle-key-file", SPARKLE_KEY_HELP),
      "maximum-deltas": Flag.String("maximum-deltas").pipe(
        Flag.withSchema(MaximumDeltasInput),
        Flag.withDescription(
          `macOS: Sparkle binary deltas to make from the newest older Sparkle-signed releases, on macOS with a Sparkle key (0-10, 0 makes none; default: ${String(DEFAULT_MAXIMUM_DELTAS)})`,
        ),
        Flag.withDefault(DEFAULT_MAXIMUM_DELTAS),
      ),
      "winsparkle-key-file": keyFileFlag("winsparkle-key-file", WINSPARKLE_KEY_HELP),
      "tauri-key-file": keyFileFlag("tauri-key-file", TAURI_KEY_HELP),
      environment: Flag.String("environment").pipe(
        Flag.withDescription(
          `Read the signing keys (${SPARKLE_PRIVATE_KEY_ENV}, ${WINSPARKLE_PRIVATE_KEY_ENV}, ${TAURI_PRIVATE_KEY_ENV}, ${TAURI_KEY_PASSWORD_ENV}) from this environment's variables when no key file or env var is set`,
        ),
        optionalFlag,
      ),
    },
    Effect.fn(
      function* (args) {
        if (platform !== "macos" && args["sparkle-key-file"] !== undefined) {
          return yield* new InvalidArgumentError({
            message: "--sparkle-key-file signs macOS releases; Windows uses --winsparkle-key-file.",
          });
        }
        if (platform !== "windows" && args["winsparkle-key-file"] !== undefined) {
          return yield* new InvalidArgumentError({
            message: "--winsparkle-key-file signs Windows releases only.",
          });
        }
        const projectId = yield* readProjectId;
        const api = yield* apiClient;
        const rolloutPercentage =
          args.rollout === undefined
            ? undefined
            : yield* parseRolloutPercentage(args.rollout, "rollout");
        const notes = (yield* readNotes(args.notes, args["notes-file"]))?.trim();
        const builds = yield* resolveReleaseBuilds(api, {
          projectId,
          platform,
          buildIds: args.buildIds,
          channel: args.channel,
        });
        const releases = yield* createDesktopReleases(api, {
          projectId,
          platform,
          builds,
          channel: args.channel,
          releaseNotes: notes === "" ? undefined : notes,
          critical: args.critical,
          rolloutPercentage,
          phasedRolloutHours: args["phased-rollout-hours"] || undefined,
          file: args.file,
          maximumDeltas: platform === "macos" ? args["maximum-deltas"] : 0,
          keys: {
            sparkleKeyFile: args["sparkle-key-file"],
            winSparkleKeyFile: args["winsparkle-key-file"],
            tauriKeyFile: args["tauri-key-file"],
            environment: args.environment,
          },
        });
        yield* printHumanTable(
          ["Release", "Build", "Version", "Format", "Rollout", "Signed", "Differential"],
          releases.map((release) => [
            release.id,
            release.buildId,
            `${release.appVersion ?? "-"} (${release.buildNumber ?? "-"})`,
            release.artifactFormat,
            releaseState(release),
            signers(release),
            differential(release),
          ]),
        );
        yield* printHuman("");
        yield* printFeeds({ platform, projectId, channel: args.channel, releases });
        // One release stays the object `--json` always gave; several are a list.
        const [only] = releases;
        return releases.length === 1 && only !== undefined ? only : releases;
      },
      runCommand({ json: "value" }),
    ),
  ).pipe(
    Command.withDescription(
      `Publish ${PLATFORM_LABELS[platform]} builds to the project's update feeds (${UPDATERS[platform]}), hashing and signing the stored artifacts`,
    ),
  );

const listCommand = (platform: DesktopPlatform) =>
  Command.make(
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
        query: { platform, limit: args.limit, ...compact({ channel: args.channel }) },
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
          signers(release),
          release.createdAt,
        ]),
      );
      const channel = args.channel ?? DEFAULT_DESKTOP_CHANNEL;
      yield* printHuman("");
      yield* printFeeds({
        platform,
        projectId,
        channel,
        releases: items.filter((release) => release.channel === channel),
      });
    }, runCommand()),
  ).pipe(
    Command.withDescription(
      `List the project's ${PLATFORM_LABELS[platform]} update-feed releases, newest first`,
    ),
  );

const releaseIdArgument = (platform: DesktopPlatform) =>
  Argument.String("releaseId").pipe(
    Argument.withDescription(`Release ID (from \`${platform} release list\`)`),
  );

const haltCommand = (platform: DesktopPlatform) =>
  Command.make(
    "halt",
    { releaseId: releaseIdArgument(platform) },
    Effect.fn(
      function* (args) {
        const api = yield* apiClient;
        const release = yield* api.desktopReleases.update({
          params: { id: args.releaseId },
          payload: { halted: true },
        });
        yield* printHuman(
          `Release ${release.id} halted: the feeds stop offering it; installs that took it keep it.`,
        );
        return release;
      },
      runCommand({ json: "value" }),
    ),
  ).pipe(Command.withDescription("Stop offering a release in the update feeds"));

const resumeCommand = (platform: DesktopPlatform) =>
  Command.make(
    "resume",
    { releaseId: releaseIdArgument(platform) },
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

const rolloutCommand = (platform: DesktopPlatform) =>
  Command.make(
    "rollout",
    {
      releaseId: releaseIdArgument(platform),
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

const deleteCommand = (platform: DesktopPlatform) =>
  Command.make(
    "delete",
    { releaseId: releaseIdArgument(platform) },
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

export const desktopReleaseCommand = (platform: DesktopPlatform) =>
  Command.make("release").pipe(
    Command.withDescription(
      `Publish ${PLATFORM_LABELS[platform]} builds to ${UPDATERS[platform]} feeds with staged rollout`,
    ),
    Command.withSubcommands([
      createCommand(platform),
      listCommand(platform),
      haltCommand(platform),
      resumeCommand(platform),
      rolloutCommand(platform),
      deleteCommand(platform),
    ]),
  );
