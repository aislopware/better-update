import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import type { Platform } from "./build-profile";

export interface SignedPayload {
  readonly manifestBody: string;
  readonly signature: string;
  readonly certificateChain: string;
}

export interface SignedPayloadFileSet {
  readonly manifestBodyFile: string | undefined;
  readonly signatureFile: string | undefined;
  readonly certificateChainFile: string | undefined;
}

const emptySignedPayloadFileSet = {
  manifestBodyFile: undefined,
  signatureFile: undefined,
  certificateChainFile: undefined,
} as const satisfies SignedPayloadFileSet;

const hasAnySignedPayloadFile = (files: SignedPayloadFileSet) =>
  files.manifestBodyFile !== undefined ||
  files.signatureFile !== undefined ||
  files.certificateChainFile !== undefined;

const formatCause = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.message;
  }

  if (typeof cause === "object" && cause !== null) {
    const tagged = cause as { readonly _tag?: unknown; readonly message?: unknown };
    const tag = typeof tagged._tag === "string" ? tagged._tag : undefined;
    const message = typeof tagged.message === "string" ? tagged.message : undefined;
    if (tag && message) {
      return `${tag}: ${message}`;
    }
    if (message) {
      return message;
    }
    if (tag) {
      return tag;
    }
  }

  return String(cause);
};

const loadSignedPayloadFromFiles = <E>(params: {
  readonly files: SignedPayloadFileSet;
  readonly label: string;
  readonly makeError: (message: string) => E;
}): Effect.Effect<SignedPayload | null, E, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    if (!hasAnySignedPayloadFile(params.files)) {
      return null;
    }

    if (
      !params.files.manifestBodyFile ||
      !params.files.signatureFile ||
      !params.files.certificateChainFile
    ) {
      return yield* Effect.fail(
        params.makeError(
          `${params.label} requires ${[
            params.files.manifestBodyFile ? null : "manifest body",
            params.files.signatureFile ? null : "signature",
            params.files.certificateChainFile ? null : "certificate chain",
          ]
            .filter(Boolean)
            .join(", ")} file inputs to be provided as a complete triplet.`,
        ),
      );
    }

    const [manifestBody, signature, certificateChain] = yield* Effect.all(
      [
        fileSystem.readFileString(params.files.manifestBodyFile),
        fileSystem.readFileString(params.files.signatureFile),
        fileSystem.readFileString(params.files.certificateChainFile),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.mapError((cause) =>
        params.makeError(`${params.label} failed to read signed inputs: ${formatCause(cause)}`),
      ),
    );

    return {
      manifestBody,
      signature: signature.trim(),
      certificateChain: certificateChain.trimEnd(),
    } as const satisfies SignedPayload;
  });

export const loadOptionalSignedPayload = loadSignedPayloadFromFiles;

export const loadSignedPublishPayloads = <E>(params: {
  readonly platforms: readonly Platform[];
  readonly globalFiles: SignedPayloadFileSet;
  readonly platformFiles: Partial<Record<Platform, SignedPayloadFileSet>>;
  readonly makeError: (message: string) => E;
}): Effect.Effect<Partial<Record<Platform, SignedPayload>>, E, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const targetedPlatforms = new Set(params.platforms);
    const nonTargetedPlatforms = (["ios", "android"] as const).filter(
      (platform) =>
        !targetedPlatforms.has(platform) &&
        hasAnySignedPayloadFile(params.platformFiles[platform] ?? emptySignedPayloadFileSet),
    );
    if (nonTargetedPlatforms.length > 0) {
      return yield* Effect.fail(
        params.makeError(
          `Signed publish inputs were provided for non-targeted platform(s): ${nonTargetedPlatforms.join(", ")}.`,
        ),
      );
    }

    const hasGlobalFiles = hasAnySignedPayloadFile(params.globalFiles);
    if (
      !hasGlobalFiles &&
      Object.values(params.platformFiles).every(
        (files) => !files || !hasAnySignedPayloadFile(files),
      )
    ) {
      return {};
    }

    if (params.platforms.length > 1 && hasGlobalFiles) {
      return yield* Effect.fail(
        params.makeError(
          "Signed multi-platform publish requires per-platform file sets. Use the --*-ios and --*-android options.",
        ),
      );
    }

    if (params.platforms.length === 1 && hasGlobalFiles) {
      const [platform] = params.platforms;
      if (!platform) {
        return {};
      }
      if (hasAnySignedPayloadFile(params.platformFiles[platform] ?? emptySignedPayloadFileSet)) {
        return yield* Effect.fail(
          params.makeError(
            `Signed publish for ${platform} is ambiguous. Use either the generic file options or the ${platform}-specific file options, not both.`,
          ),
        );
      }

      const globalPayload = yield* loadSignedPayloadFromFiles({
        files: params.globalFiles,
        label: "Signed publish",
        makeError: params.makeError,
      });
      return globalPayload === null ? {} : { [platform]: globalPayload };
    }

    const platformPayloadEntries = yield* Effect.forEach(
      params.platforms,
      (platform) =>
        Effect.gen(function* () {
          const payload = yield* loadSignedPayloadFromFiles({
            files: params.platformFiles[platform] ?? emptySignedPayloadFileSet,
            label: `Signed publish for ${platform}`,
            makeError: params.makeError,
          });

          if (payload === null) {
            return yield* Effect.fail(
              params.makeError(
                `Signed multi-platform publish requires a signed payload for ${platform}.`,
              ),
            );
          }

          return [platform, payload] as const;
        }),
      { concurrency: 1 },
    );

    return Object.fromEntries(platformPayloadEntries) as Partial<Record<Platform, SignedPayload>>;
  });
