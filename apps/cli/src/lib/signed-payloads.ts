import { isRecord } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import type { ManifestAssetData, ManifestUpdateData } from "@better-update/expo-protocol";

import { formatCause } from "./format-error";
import { renderManifest, signBody } from "./manifest-signing";

import type { Platform } from "./build-profile";
import type { UpdatePublishError } from "./exit-codes";

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

const loadSignedPayloadFromFiles = <Err>(params: {
  readonly files: SignedPayloadFileSet;
  readonly label: string;
  readonly makeError: (message: string) => Err;
}): Effect.Effect<SignedPayload | null, Err, FileSystem.FileSystem> =>
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

/**
 * Render-and-sign producer path (the preferred alternative to the file
 * escape-hatch). Renders the manifest with the Worker bundle URL
 * (`launchAsset.url`) and signs the EXACT rendered bytes, returning the same
 * {@link SignedPayload} shape the file path produces. The `manifestBody` string
 * returned here is BOTH the signed input AND the value sent to the server — one
 * variable, no re-stringify — so the signed bytes are precisely the served bytes
 * (see byteIdentityPlan).
 */
export const buildSignedPayloadFromRender = (params: {
  readonly update: ManifestUpdateData;
  readonly assets: readonly ManifestAssetData[];
  readonly assetBaseUrl: string;
  readonly serverBaseUrl: string;
  readonly projectId: string;
  readonly codeSigning: {
    readonly privateKeyPem: string;
    readonly certificateChainPem: string;
    readonly keyid: string;
  };
}): Effect.Effect<SignedPayload, UpdatePublishError> =>
  Effect.gen(function* () {
    const manifestBody = renderManifest({
      update: params.update,
      assets: params.assets,
      assetBaseUrl: params.assetBaseUrl,
      serverBaseUrl: params.serverBaseUrl,
      projectId: params.projectId,
    });
    const { signature } = yield* signBody({
      bodyBytes: manifestBody,
      privateKeyPem: params.codeSigning.privateKeyPem,
      certificatePem: params.codeSigning.certificateChainPem,
      keyid: params.codeSigning.keyid,
    });
    return {
      manifestBody,
      signature,
      certificateChain: params.codeSigning.certificateChainPem,
    } as const satisfies SignedPayload;
  });

/**
 * Gap-D guard for signed updates. The server serves a signed `manifestBody`
 * BYTE-FOR-BYTE (it never re-renders it), so for the Worker to negotiate bsdiff
 * patches the launch asset URL INSIDE the signed body must already point at the
 * Worker bundle route — `${serverBaseUrl}/manifest/{projectId}/bundle/{id}/{hash}`
 * — not a CDN `/assets/{hash}` URL. If it points at the CDN, patches silently
 * never apply for that update.
 *
 * The body's `launchAsset.hash` is the content checksum, while the URL's trailing
 * hash is the namespaced routing hash, so we cannot reconstruct the exact URL
 * here; instead we assert the URL begins with the Worker bundle-route prefix for
 * THIS (server, project, manifest-id). The manifest's own `id` is the update id
 * the device reports as `expo-requested-update-id`, so it keys the bundle route.
 *
 * OPERATIONAL CONSTRAINT: this guard checks the URL prefix against the CLI's
 * configured `serverBaseUrl`, but the deployed Worker serves and negotiates
 * patches from its own `PUBLIC_API_URL`. For signed updates these MUST be the
 * same origin — if the CLI base URL and the server's `PUBLIC_API_URL` diverge
 * (e.g. a custom domain vs the workers.dev URL), a signed body can pass this
 * guard yet embed a launch URL the deployed Worker does not serve, and the
 * device hits a different origin than the patch-negotiating Worker. Keep the
 * CLI's configured base URL equal to the server's `PUBLIC_API_URL`.
 */
export const assertSignedManifestBundleUrl = <Err>(params: {
  readonly manifestBody: string;
  readonly serverBaseUrl: string;
  readonly projectId: string;
  readonly platform: Platform;
  readonly makeError: (message: string) => Err;
}): Effect.Effect<void, Err> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: (): unknown => JSON.parse(params.manifestBody),
      catch: () => params.makeError(`Signed ${params.platform} manifestBody is not valid JSON.`),
    });
    if (!isRecord(parsed)) {
      return yield* Effect.fail(
        params.makeError(`Signed ${params.platform} manifestBody must be a JSON object.`),
      );
    }
    const { id } = parsed;
    const { launchAsset } = parsed;
    if (typeof id !== "string" || !isRecord(launchAsset)) {
      return yield* Effect.fail(
        params.makeError(
          `Signed ${params.platform} manifestBody must carry a string "id" and an object "launchAsset".`,
        ),
      );
    }
    const { url } = launchAsset;
    const expectedPrefix = `${params.serverBaseUrl}/manifest/${params.projectId}/bundle/${id}/`;
    if (typeof url !== "string" || !url.startsWith(expectedPrefix)) {
      return yield* Effect.fail(
        params.makeError(
          `Signed ${params.platform} manifestBody launchAsset.url must point at the Worker bundle route (${expectedPrefix}…) so bsdiff patches apply; got ${typeof url === "string" ? url : "a non-string value"}. Re-render the signed manifest with the Worker bundle URL.`,
        ),
      );
    }
    return undefined;
  });

export const loadSignedPublishPayloads = <Err>(params: {
  readonly platforms: readonly Platform[];
  readonly globalFiles: SignedPayloadFileSet;
  readonly platformFiles: Partial<Record<Platform, SignedPayloadFileSet>>;
  readonly makeError: (message: string) => Err;
}): Effect.Effect<Partial<Record<Platform, SignedPayload>>, Err, FileSystem.FileSystem> =>
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
      Object.values(params.platformFiles).every((files) => !hasAnySignedPayloadFile(files))
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

    return Object.fromEntries(platformPayloadEntries);
  });
