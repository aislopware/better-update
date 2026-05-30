import { defineCommand } from "citty";
import { Effect } from "effect";

import type { CommandExecutor, FileSystem } from "@effect/platform";

import { runEffect } from "../../lib/citty-effect";
import { FingerprintMismatchError } from "../../lib/exit-codes";
import {
  diffFingerprintSources,
  FingerprintError,
  runFingerprintForPlatform,
  runFingerprintFull,
} from "../../lib/fingerprint";
import { printHuman } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";

import type { Platform } from "../../lib/build-profile";
import type { AuthRequiredError } from "../../lib/exit-codes";
import type { FingerprintDiffItem, FingerprintSource } from "../../lib/fingerprint";
import type { ApiClient, ApiClientService } from "../../services/api-client";

/**
 * Normalize the `--platform` flag. When set, the local fingerprint is computed
 * per-platform (matching EAS + the per-platform hash recorded on builds/updates),
 * so a compare against a stored hash lines up. When omitted, the bare
 * combined-platform fingerprint is used.
 */
const parsePlatform = (value: unknown): Platform | undefined => {
  if (value === "ios" || value === "android") {
    return value;
  }
  return undefined;
};

interface ResolvedSides {
  readonly side1: FingerprintRef;
  readonly side2: FingerprintRef;
}

/**
 * Human-readable labels for known `contents`-type fingerprint source ids, so the
 * source-level diff reads like EAS's `fingerprint:compare`. Unknown ids fall
 * back to the raw id.
 */
const PRETTY_CONTENT_ID: Readonly<Record<string, string>> = {
  expoConfig: "Expo config (app.json / app.config.*)",
  "packageJson:scripts": "package.json scripts",
  "package:react-native": "react-native package version",
  expoAutolinkingConfigIos: "Expo autolinking config (iOS)",
  expoAutolinkingConfigAndroid: "Expo autolinking config (Android)",
  "expoAutolinkingConfig:ios": "Expo autolinking config (iOS)",
  "expoAutolinkingConfig:android": "Expo autolinking config (Android)",
  bareRncliAutolinking: "React Native CLI autolinking",
};

/** A resolved side of the comparison: always a hash; sources only when local. */
interface FingerprintRef {
  readonly label: string;
  readonly hash: string;
  readonly sources?: readonly FingerprintSource[];
}

/**
 * Normalize a citty arg (which collects repeated flags into an array, but is
 * declared as `string`) into a string array of trimmed, non-empty values.
 */
const toArray = (value: unknown): readonly unknown[] => {
  if (Array.isArray(value)) {
    return value;
  }
  return value === undefined ? [] : [value];
};

const toStringArray = (value: unknown): readonly string[] =>
  toArray(value)
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const fetchBuildRef = (
  api: ApiClient,
  id: string,
): Effect.Effect<FingerprintRef, FingerprintError> =>
  Effect.gen(function* () {
    const build = yield* api.builds
      .get({ path: { id } })
      .pipe(
        Effect.mapError(
          (cause) =>
            new FingerprintError({ message: `Failed to fetch build ${id}: ${String(cause)}` }),
        ),
      );
    if (build.fingerprintHash === null) {
      return yield* new FingerprintError({
        message: `Build ${id} has no recorded fingerprint hash (it was published before fingerprint capture).`,
      });
    }
    return { label: `build ${id}`, hash: build.fingerprintHash };
  });

const fetchUpdateRef = (
  api: ApiClient,
  id: string,
): Effect.Effect<FingerprintRef, FingerprintError> =>
  Effect.gen(function* () {
    const update = yield* api.updates
      .get({ path: { id } })
      .pipe(
        Effect.mapError(
          (cause) =>
            new FingerprintError({ message: `Failed to fetch update ${id}: ${String(cause)}` }),
        ),
      );
    if (update.fingerprintHash === null) {
      return yield* new FingerprintError({
        message: `Update ${id} has no recorded fingerprint hash (it was published before fingerprint capture).`,
      });
    }
    return { label: `update ${id}`, hash: update.fingerprintHash };
  });

const localRef = (
  projectRoot: string,
  platform: Platform | undefined,
): Effect.Effect<
  FingerprintRef,
  FingerprintError,
  CommandExecutor.CommandExecutor | FileSystem.FileSystem
> =>
  (platform === undefined
    ? runFingerprintFull(projectRoot)
    : runFingerprintForPlatform(projectRoot, platform)
  ).pipe(
    Effect.map(
      (result): FingerprintRef => ({
        label: platform === undefined ? "local project" : `local project (${platform})`,
        hash: result.hash,
        sources: result.sources,
      }),
    ),
  );

const isPathSource = (item: FingerprintDiffItem): boolean =>
  item.type === "file" || item.type === "dir";

const prettySourceId = (item: FingerprintDiffItem): string => {
  if (isPathSource(item)) {
    return item.sourceId;
  }
  return PRETTY_CONTENT_ID[item.sourceId] ?? item.sourceId;
};

const OP_SYMBOL: Readonly<Record<FingerprintDiffItem["op"], string>> = {
  added: "+",
  removed: "-",
  modified: "~",
};

/** Render the source-level diff as human output, grouped by kind. */
const renderSourceDiff = (
  side1: FingerprintRef,
  side2: FingerprintRef,
  diff: readonly FingerprintDiffItem[],
) =>
  Effect.gen(function* () {
    if (diff.length === 0) {
      yield* printHuman(`Fingerprints match: ${side1.hash}`);
      return;
    }
    yield* printHuman(`Fingerprint sources differ (${side1.label} -> ${side2.label}):`);
    const pathItems = diff.filter((item) => isPathSource(item));
    const contentItems = diff.filter((item) => !isPathSource(item));
    if (pathItems.length > 0) {
      yield* printHuman("");
      yield* printHuman("Paths with native dependencies:");
      for (const item of pathItems) {
        yield* printHuman(`  ${OP_SYMBOL[item.op]} ${prettySourceId(item)}`);
      }
    }
    if (contentItems.length > 0) {
      yield* printHuman("");
      yield* printHuman("Configuration / contents:");
      for (const item of contentItems) {
        yield* printHuman(`  ${OP_SYMBOL[item.op]} ${prettySourceId(item)}`);
      }
    }
  });

export const compareCommand = defineCommand({
  meta: {
    name: "compare",
    description:
      "Compare two fingerprints by build id, update id, or against the local project; shows the source diff when sources are available locally.",
  },
  args: {
    hash: {
      type: "positional",
      required: false,
      description: "Fingerprint hash to compare against the local project",
    },
    "build-id": {
      type: "string",
      description: "Build id to resolve a fingerprint from (repeatable, max 2)",
    },
    "update-id": {
      type: "string",
      description: "Update id to resolve a fingerprint from (repeatable, max 2)",
    },
    platform: {
      type: "string",
      description:
        "Compute the local fingerprint for a single platform (ios|android) to match the per-platform hash recorded on builds/updates",
    },
  },
  run: async ({ args }) =>
    runEffect(runCompare(args), {
      exits: { FingerprintError: 2, FingerprintMismatchError: 1 },
      json: "value",
    }),
});

interface CompareArgs {
  readonly hash?: unknown;
  readonly "build-id"?: unknown;
  readonly "update-id"?: unknown;
  readonly platform?: unknown;
}

export const runCompare = (args: CompareArgs) =>
  Effect.gen(function* () {
    const buildIds = toStringArray(args["build-id"]);
    const updateIds = toStringArray(args["update-id"]);

    if (buildIds.length + updateIds.length > 2) {
      return yield* new FingerprintError({
        message: "Compare at most two fingerprints (combined --build-id and --update-id).",
      });
    }

    const runtime = yield* CliRuntime;
    const projectRoot = yield* runtime.cwd;
    const idRefs = yield* buildIdRefs(buildIds, updateIds);

    const { side1, side2 } = yield* resolveSides({
      idRefs,
      positionalHash: typeof args.hash === "string" ? args.hash.trim() : undefined,
      projectRoot,
      platform: parsePlatform(args.platform),
    });

    return yield* compareSides(side1, side2);
  });

/**
 * Build the resolution effects for the requested ids. The server is only
 * contacted (via `apiClient`) when at least one id is supplied, so the
 * hash-vs-local and nothing-to-compare paths never require auth.
 */
const buildIdRefs = (
  buildIds: readonly string[],
  updateIds: readonly string[],
): Effect.Effect<
  readonly Effect.Effect<FingerprintRef, FingerprintError>[],
  AuthRequiredError,
  ApiClientService
> =>
  Effect.gen(function* () {
    if (buildIds.length + updateIds.length === 0) {
      return [];
    }
    const api = yield* apiClient;
    return [
      ...buildIds.map((id) => fetchBuildRef(api, id)),
      ...updateIds.map((id) => fetchUpdateRef(api, id)),
    ];
  });

/**
 * Render the verdict for two resolved sides and return the JSON payload. When
 * both sides expose sources a source-level diff is produced; otherwise only the
 * hashes are compared (the server stores no source tree). Differing hashes fail
 * with {@link FingerprintMismatchError} (exit 1).
 */
const compareSides = (side1: FingerprintRef, side2: FingerprintRef) =>
  Effect.gen(function* () {
    const matched = side1.hash === side2.hash;

    if (side1.sources !== undefined && side2.sources !== undefined) {
      const diff = diffFingerprintSources(side1.sources, side2.sources);
      yield* renderSourceDiff(side1, side2, diff);
      if (!matched) {
        return yield* new FingerprintMismatchError({
          message: `Fingerprint mismatch.\n  ${side1.label}: ${side1.hash}\n  ${side2.label}: ${side2.hash}`,
          localHash: side1.hash,
          providedHash: side2.hash,
        });
      }
      return { side1: stripRef(side1), side2: stripRef(side2), diff, matched } as const;
    }

    if (matched) {
      yield* printHuman(`Fingerprints match: ${side1.hash}`);
      return { side1: stripRef(side1), side2: stripRef(side2), matched } as const;
    }
    return yield* new FingerprintMismatchError({
      message: [
        "Fingerprint mismatch.",
        `  ${side1.label}: ${side1.hash}`,
        `  ${side2.label}: ${side2.hash}`,
        "",
        "Source-level diff unavailable: better-update stores only the fingerprint hash on the",
        "server, not the source tree. Run `better-update fingerprint compare <id>` against a",
        "local checkout of one revision to see which sources changed.",
      ].join("\n"),
      localHash: side1.hash,
      providedHash: side2.hash,
    });
  });

interface ResolveSidesParams {
  readonly idRefs: readonly Effect.Effect<FingerprintRef, FingerprintError>[];
  readonly positionalHash: string | undefined;
  readonly projectRoot: string;
  readonly platform: Platform | undefined;
}

/**
 * Resolve the two comparison sides from the supplied id refs, the positional
 * hash, and the local project, following EAS's argument precedence:
 *
 * - 2 ids -> both sides from the server.
 * - 1 id -> server side vs the local project.
 * - 1 hash (no ids) -> the provided hash vs the local project.
 * - nothing -> error (nothing to compare).
 */
const resolveSides = ({
  idRefs,
  positionalHash,
  projectRoot,
  platform,
}: ResolveSidesParams): Effect.Effect<
  ResolvedSides,
  FingerprintError,
  CommandExecutor.CommandExecutor | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const [firstRef, secondRef] = idRefs;
    if (firstRef !== undefined && secondRef !== undefined) {
      const side1 = yield* firstRef;
      const side2 = yield* secondRef;
      return { side1, side2 };
    }
    if (firstRef !== undefined) {
      const side1 = yield* firstRef;
      const side2 = yield* localRef(projectRoot, platform);
      return { side1, side2 };
    }
    if (positionalHash !== undefined && positionalHash.length > 0) {
      const side1: FingerprintRef = { label: "provided hash", hash: positionalHash };
      const side2 = yield* localRef(projectRoot, platform);
      return { side1, side2 };
    }
    return yield* new FingerprintError({
      message:
        "Nothing to compare. Pass a fingerprint hash, or --build-id / --update-id (one to compare against the local project, two to compare server-side).",
    });
  });

/** Drop the in-memory `sources` from a ref for the JSON payload (hash + label only). */
const stripRef = (
  ref: FingerprintRef,
): { readonly label: string; readonly hash: string; readonly hasSources: boolean } => ({
  label: ref.label,
  hash: ref.hash,
  hasSources: ref.sources !== undefined,
});
