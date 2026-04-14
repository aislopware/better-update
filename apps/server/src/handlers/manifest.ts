import { Effect } from "effect";

import type { BadRequest, NotFound } from "@better-update/api";

import { provideCloudflareRequestContext } from "../cloudflare/context";
import { manifestRuntime } from "../cloudflare/manifest-runtime";
import { evaluateBranchMapping } from "../domain/branch-mapping";
import { resolveUpdateRollout } from "../domain/update-rollout";
import { parseProtocolHeaders } from "../protocol/headers";
import { buildDirective, buildExtensions, buildManifest } from "../protocol/manifest-builder";
import { encodeMultipart } from "../protocol/multipart";
import { ManifestRepo, ManifestRepoLive } from "../repositories/manifest";
import { buildCacheKey, matchCachedResponse, storeCachedResponse } from "./manifest-cache";
import { respond, responseTypeFor } from "./manifest-helpers";

import type { ProtocolHeaders } from "../protocol/headers";
import type { PatchedAssetInfo } from "../protocol/manifest-builder";
import type { Part } from "../protocol/multipart";
import type { AssetRow, ChannelRow, UpdateRow } from "../repositories/manifest";
import type { TrackManifestResponse } from "./manifest-helpers";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const COMMON_HEADERS: Record<string, string> = {
  "expo-protocol-version": "1",
  "expo-sfv-version": "0",
  "cache-control": "private, max-age=0",
};

const protocolResponse = (body: string | null, status: number, headers?: Record<string, string>) =>
  new Response(body, { status, headers: { ...COMMON_HEADERS, ...headers } });

const jsonError = (status: number, code: string, message: string) =>
  protocolResponse(JSON.stringify({ code, message }), status, {
    "content-type": "application/json",
  });
const noContent = () => protocolResponse(null, 204);
const multipartResponse = (boundary: string, parts: readonly Part[]) =>
  protocolResponse(encodeMultipart(boundary, parts), 200, {
    "content-type": `multipart/mixed; boundary=${boundary}`,
  });
const jsonManifestResponse = (manifestJson: string, signature: string | undefined) =>
  protocolResponse(manifestJson, 200, {
    "content-type": "application/expo+json",
    ...(signature ? { "expo-signature": signature } : {}),
  });

const supportsMultipart = (accept: string) =>
  accept.includes("multipart/mixed") || accept.includes("*/*");
const supportsAny = (accept: string) =>
  supportsMultipart(accept) ||
  accept.includes("application/expo+json") ||
  accept.includes("application/json");

const signedPart = (name: string, body: string, signature: string | undefined): Part => ({
  name,
  contentType: "application/json",
  ...(signature ? { headers: { "expo-signature": signature } } : {}),
  body,
});

const extensionsPart: Part = {
  name: "extensions",
  contentType: "application/json",
  body: JSON.stringify(buildExtensions()),
};

const buildExtensionsPart = (patchedAsset?: PatchedAssetInfo): Part =>
  patchedAsset
    ? {
        name: "extensions",
        contentType: "application/json",
        body: JSON.stringify(buildExtensions({ patchedAsset })),
      }
    : extensionsPart;

const signatureFor = (ph: ProtocolHeaders, update: UpdateRow) =>
  ph.expectSignature ? (update.signature ?? undefined) : undefined;
const certChainParts = (ph: ProtocolHeaders, update: UpdateRow): readonly Part[] =>
  ph.expectSignature && update.certificate_chain
    ? [
        {
          name: "certificate_chain",
          contentType: "application/x-pem-file",
          body: update.certificate_chain,
        },
      ]
    : [];

const parseJson = (raw: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(raw);
  return isRecord(parsed) ? parsed : {};
};

const buildDirectiveResponse = (
  update: UpdateRow,
  ph: ProtocolHeaders,
  boundary: string,
  patchedAsset?: PatchedAssetInfo,
) => {
  const directiveJson = update.directive_body
    ? parseJson(update.directive_body)
    : buildDirective({
        update: {
          id: update.id,
          createdAt: update.created_at,
          runtimeVersion: update.runtime_version,
          metadata: {},
          extra: undefined,
        },
      });

  return multipartResponse(boundary, [
    signedPart("directive", JSON.stringify(directiveJson), signatureFor(ph, update)),
    ...certChainParts(ph, update),
    buildExtensionsPart(patchedAsset),
  ]);
};

const buildManifestFromData = (params: {
  readonly update: UpdateRow;
  readonly assetRows: readonly AssetRow[];
  readonly scopeKey: string;
  readonly assetBaseUrl: string;
  readonly ph: ProtocolHeaders;
  readonly boundary: string;
  readonly useMultipart: boolean;
  readonly patchedAsset: PatchedAssetInfo | undefined;
}) => {
  const { update, assetRows, scopeKey, assetBaseUrl, ph, boundary, useMultipart, patchedAsset } =
    params;
  const manifestStr = JSON.stringify(
    buildManifest({
      update: {
        id: update.id,
        createdAt: update.created_at,
        runtimeVersion: update.runtime_version,
        metadata: parseJson(update.metadata_json),
        extra: update.extra_json ? parseJson(update.extra_json) : undefined,
      },
      assets: assetRows.map((row) => ({
        key: row.asset_key,
        hash: row.hash,
        contentType: row.content_type,
        fileExt: row.file_ext,
        isLaunch: row.is_launch === 1,
      })),
      scopeKey,
      assetBaseUrl,
    }),
  );

  const sig = signatureFor(ph, update);
  if (!useMultipart) {
    return jsonManifestResponse(manifestStr, sig);
  }

  return multipartResponse(boundary, [
    signedPart("manifest", manifestStr, sig),
    ...certChainParts(ph, update),
    buildExtensionsPart(patchedAsset),
  ]);
};

const trackNoUpdate = (branchId: string, track: TrackManifestResponse) => {
  track(branchId, "", "no_update");
  return noContent();
};

const resolveRolledOutUpdate = (params: {
  readonly candidates: readonly UpdateRow[];
  readonly easClientId: string | undefined;
  readonly branchId: string;
  readonly platform: string;
  readonly runtimeVersion: string;
}): Effect.Effect<UpdateRow | null, never, ManifestRepo> =>
  Effect.gen(function* () {
    const rolloutResult = yield* Effect.promise(async () =>
      resolveUpdateRollout(params.candidates, params.easClientId),
    );

    if (rolloutResult === null) {
      return null;
    }

    if (rolloutResult.resolved) {
      return rolloutResult.update;
    }

    if (rolloutResult.needsFallbackQuery) {
      const repo = yield* ManifestRepo;
      return yield* repo.resolveFullyRolledOutUpdate({
        branchId: params.branchId,
        platform: params.platform,
        runtimeVersion: params.runtimeVersion,
      });
    }

    return null;
  });

const resolveBranchId = (channel: ChannelRow, easClientId: string | undefined) => {
  const { branch_mapping_json: mapping } = channel;
  return mapping
    ? Effect.tryPromise(async () => evaluateBranchMapping(mapping, easClientId)).pipe(
        Effect.orElseSucceed(() => channel.branch_id),
      )
    : Effect.succeed(channel.branch_id);
};

const buildUpdateResponse = (params: {
  readonly update: UpdateRow;
  readonly scopeKey: string;
  readonly ph: ProtocolHeaders;
  readonly patchedAsset: PatchedAssetInfo | undefined;
}): Effect.Effect<Response, never, ManifestRepo> =>
  Effect.gen(function* () {
    const { update, scopeKey, ph, patchedAsset } = params;
    const runtime = yield* manifestRuntime;
    const boundary = crypto.randomUUID();
    const useMultipart = supportsMultipart(ph.accept ?? "*/*");

    if (update.is_rollback === 1) {
      if (!useMultipart) {
        return jsonError(406, "NOT_ACCEPTABLE", "Directive requires multipart/mixed");
      }
      return buildDirectiveResponse(update, ph, boundary, patchedAsset);
    }

    if (update.manifest_body !== null) {
      const sig = signatureFor(ph, update);
      if (!useMultipart) {
        return jsonManifestResponse(update.manifest_body, sig);
      }
      return multipartResponse(boundary, [
        signedPart("manifest", update.manifest_body, sig),
        ...certChainParts(ph, update),
        buildExtensionsPart(patchedAsset),
      ]);
    }

    const repo = yield* ManifestRepo;
    const assetRows = yield* repo.findUpdateAssets({ updateId: update.id });
    return buildManifestFromData({
      update,
      assetRows,
      scopeKey,
      assetBaseUrl: runtime.assetBaseUrl,
      ph,
      boundary,
      useMultipart,
      patchedAsset,
    });
  });
const isCacheable = (candidates: readonly UpdateRow[]) =>
  candidates.every((candidate) => candidate.rollout_percentage === 100);

const handleCacheMiss = (params: {
  readonly projectId: string;
  readonly resolvedBranchId: string;
  readonly cacheKey: string;
  readonly ph: ProtocolHeaders;
  readonly track: TrackManifestResponse;
}): Effect.Effect<Response, NotFound, ManifestRepo> =>
  Effect.gen(function* () {
    const { projectId, resolvedBranchId, cacheKey, ph, track } = params;
    const repo = yield* ManifestRepo;

    const [scopeKey, candidates] = yield* Effect.all(
      [
        repo.findProjectScopeKey({ projectId }),
        repo.resolveUpdates({
          branchId: resolvedBranchId,
          platform: ph.platform,
          runtimeVersion: ph.runtimeVersion,
        }),
      ],
      { concurrency: 2 },
    );

    if (candidates.length === 0) {
      return trackNoUpdate(resolvedBranchId, track);
    }

    const update = yield* resolveRolledOutUpdate({
      candidates,
      easClientId: ph.easClientId,
      branchId: resolvedBranchId,
      platform: ph.platform,
      runtimeVersion: ph.runtimeVersion,
    });
    if (update === null) {
      return trackNoUpdate(resolvedBranchId, track);
    }

    const response = yield* buildUpdateResponse({ update, scopeKey, ph, patchedAsset: undefined });
    const responseType = responseTypeFor(update);
    track(resolvedBranchId, update.id, responseType);

    if (response.status === 200 && isCacheable(candidates)) {
      yield* storeCachedResponse(cacheKey, response, { updateId: update.id, responseType });
    }

    return response;
  });

const resolvePatchInfo = (params: {
  readonly update: UpdateRow;
  readonly currentUpdateId: string;
}): Effect.Effect<PatchedAssetInfo | undefined, never, ManifestRepo> =>
  Effect.gen(function* () {
    const { update, currentUpdateId } = params;
    if (update.id === currentUpdateId || update.is_rollback === 1) {
      return undefined;
    }
    const repo = yield* ManifestRepo;
    const runtime = yield* manifestRuntime;
    const oldHash = yield* repo.findUpdateLaunchAssetHash({ updateId: currentUpdateId });
    if (!oldHash) {
      return undefined;
    }
    const newAssets = yield* repo.findUpdateAssets({ updateId: update.id });
    const newLaunch = newAssets.find((asset) => asset.is_launch === 1);
    if (!newLaunch || oldHash === newLaunch.hash) {
      return undefined;
    }
    const patch = yield* repo.findPatchForAssets({ oldHash, newHash: newLaunch.hash });
    if (!patch) {
      return undefined;
    }
    return {
      patchUrl: `${runtime.assetBaseUrl}/patches/${oldHash}/${newLaunch.hash}.patch`,
      patchSize: patch.byteSize,
      baseHash: oldHash,
    };
  });

const handlePatchAwareRequest = (params: {
  readonly projectId: string;
  readonly resolvedBranchId: string;
  readonly ph: ProtocolHeaders & { currentUpdateId: string };
  readonly track: TrackManifestResponse;
}): Effect.Effect<Response, NotFound, ManifestRepo> =>
  Effect.gen(function* () {
    const { projectId, resolvedBranchId, ph, track } = params;
    const repo = yield* ManifestRepo;

    const [scopeKey, candidates] = yield* Effect.all(
      [
        repo.findProjectScopeKey({ projectId }),
        repo.resolveUpdates({
          branchId: resolvedBranchId,
          platform: ph.platform,
          runtimeVersion: ph.runtimeVersion,
        }),
      ],
      { concurrency: 2 },
    );

    if (candidates.length === 0) {
      return trackNoUpdate(resolvedBranchId, track);
    }

    const update = yield* resolveRolledOutUpdate({
      candidates,
      easClientId: ph.easClientId,
      branchId: resolvedBranchId,
      platform: ph.platform,
      runtimeVersion: ph.runtimeVersion,
    });
    if (update === null) {
      return trackNoUpdate(resolvedBranchId, track);
    }

    const patchedAsset = yield* resolvePatchInfo({
      update,
      currentUpdateId: ph.currentUpdateId,
    });

    const response = yield* buildUpdateResponse({ update, scopeKey, ph, patchedAsset });
    const responseType = responseTypeFor(update);
    track(resolvedBranchId, update.id, responseType);
    return response;
  });

const serveCachedOrFresh = (params: {
  readonly cacheVersion: number;
  readonly projectId: string;
  readonly resolvedBranchId: string;
  readonly accept: string;
  readonly ph: ProtocolHeaders;
  readonly track: TrackManifestResponse;
}): Effect.Effect<Response, NotFound, ManifestRepo> =>
  Effect.gen(function* () {
    const { cacheVersion, projectId, resolvedBranchId, accept, ph, track } = params;
    const cacheKey = buildCacheKey({
      cacheVersion,
      projectId,
      channelName: ph.channelName,
      platform: ph.platform,
      runtimeVersion: ph.runtimeVersion,
      resolvedBranchId,
      multipart: supportsMultipart(accept),
      expectSignature: Boolean(ph.expectSignature),
    });
    const cached = yield* matchCachedResponse(cacheKey);
    if (cached) {
      track(resolvedBranchId, cached.updateId, cached.responseType);
      return cached.response;
    }
    return yield* handleCacheMiss({ projectId, resolvedBranchId, cacheKey, ph, track });
  });

const resolveRequestResponse = (params: {
  readonly channel: ChannelRow;
  readonly projectId: string;
  readonly resolvedBranchId: string;
  readonly accept: string;
  readonly ph: ProtocolHeaders;
  readonly track: TrackManifestResponse;
}): Effect.Effect<Response, NotFound, ManifestRepo> => {
  const { channel, projectId, resolvedBranchId, accept, ph, track } = params;
  return ph.currentUpdateId
    ? handlePatchAwareRequest({
        projectId,
        resolvedBranchId,
        ph: { ...ph, currentUpdateId: ph.currentUpdateId },
        track,
      })
    : serveCachedOrFresh({
        cacheVersion: channel.cache_version,
        projectId,
        resolvedBranchId,
        accept,
        ph,
        track,
      });
};

const serveRequest = (
  request: Request,
  projectId: string,
): Effect.Effect<Response, BadRequest | NotFound, ManifestRepo> =>
  Effect.gen(function* () {
    const startTime = Date.now();
    const runtime = yield* manifestRuntime;
    const ph = yield* parseProtocolHeaders(request.headers);
    const accept = ph.accept ?? "*/*";
    if (!supportsAny(accept)) {
      return jsonError(406, "NOT_ACCEPTABLE", "Supported: multipart/mixed, application/expo+json");
    }

    const repo = yield* ManifestRepo;
    const channel = yield* repo.resolveChannel({ projectId, channelName: ph.channelName });
    const track = runtime.createTracker({ projectId, ph, startTime });

    if (channel.is_paused === 1) {
      return respond(trackNoUpdate(channel.branch_id, track), ph);
    }

    const resolvedBranchId = yield* resolveBranchId(channel, ph.easClientId);
    const response = yield* resolveRequestResponse({
      channel,
      projectId,
      resolvedBranchId,
      accept,
      ph,
      track,
    });
    return respond(response, ph);
  });

const toManifestErrorResponse = (error: BadRequest | NotFound) =>
  error._tag === "BadRequest"
    ? jsonError(400, "BAD_REQUEST", error.message)
    : jsonError(404, "NOT_FOUND", error.message);

const serve = (request: Request, projectId: string): Effect.Effect<Response, never, ManifestRepo> =>
  Effect.match(serveRequest(request, projectId), {
    onFailure: toManifestErrorResponse,
    onSuccess: (response) => response,
  });

export const serveManifest = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  projectId: string,
): Promise<Response> =>
  Effect.runPromise(
    provideCloudflareRequestContext(
      serve(request, projectId).pipe(Effect.provide(ManifestRepoLive)),
      env,
      ctx,
    ),
  );
