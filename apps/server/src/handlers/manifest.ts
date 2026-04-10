import { Effect } from "effect";

import type { NotFound } from "@better-update/api";

import { cloudflareCtx, cloudflareEnv } from "../cloudflare/context";
import { evaluateBranchMapping } from "../domain/branch-mapping";
import { resolveUpdateRollout } from "../domain/update-rollout";
import { parseProtocolHeaders } from "../protocol/headers";
import { buildDirective, buildExtensions, buildManifest } from "../protocol/manifest-builder";
import { encodeMultipart } from "../protocol/multipart";
import { ManifestRepo, ManifestRepoLive } from "../repositories/manifest";

import type { ProtocolHeaders } from "../protocol/headers";
import type { Part } from "../protocol/multipart";
import type { AssetRow, ChannelRow, UpdateRow } from "../repositories/manifest";

type ResponseType = "manifest" | "directive" | "no_update";

// -- Common protocol headers (required on ALL responses) ---------------------

const COMMON_HEADERS: Record<string, string> = {
  "expo-protocol-version": "1",
  "expo-sfv-version": "0",
  "cache-control": "private, max-age=0",
};

// -- Response helpers --------------------------------------------------------

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

// -- Accept negotiation ------------------------------------------------------

const supportsMultipart = (accept: string) =>
  accept.includes("multipart/mixed") || accept.includes("*/*");

const supportsAny = (accept: string) =>
  supportsMultipart(accept) ||
  accept.includes("application/expo+json") ||
  accept.includes("application/json");

// -- Part builders -----------------------------------------------------------

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

// eslint-disable-next-line typescript/no-unsafe-type-assertion -- D1 JSON columns are trusted application data
const parseJson = (raw: string) => JSON.parse(raw) as Record<string, unknown>;

// -- L1 Cache helpers (Workers Cache API) ------------------------------------

const CACHE_NAME = "manifests";
/** 24 hours */
const INTERNAL_TTL = 86_400;

const buildCacheKey = (params: {
  readonly cacheVersion: number;
  readonly projectId: string;
  readonly channelName: string;
  readonly platform: string;
  readonly runtimeVersion: string;
  readonly resolvedBranchId: string;
  readonly multipart: boolean;
  readonly expectSignature: boolean;
}) =>
  `https://cache.internal/_cache/v${params.cacheVersion}/manifest/${params.projectId}/${params.channelName}/${params.platform}/${params.runtimeVersion}/${params.resolvedBranchId}/${params.multipart ? "mp" : "json"}/${params.expectSignature ? "sig" : "nosig"}`;

const toCacheEntry = (
  response: Response,
  meta: { readonly updateId: string; readonly responseType: ResponseType },
) => {
  const headers = new Headers(response.headers);
  headers.set("cache-control", `public, max-age=${INTERNAL_TTL}`);
  headers.set("x-cache-update-id", meta.updateId);
  headers.set("x-cache-response-type", meta.responseType);
  return new Response(response.clone().body, { status: response.status, headers });
};

const fromCacheEntry = (cached: Response) => {
  const headers = new Headers(cached.headers);
  headers.delete("x-cache-update-id");
  headers.delete("x-cache-response-type");
  headers.set("cache-control", "private, max-age=0");
  return new Response(cached.body, { status: cached.status, headers });
};

// -- Response builders (extracted to stay within max-statements) --------------

const buildDirectiveResponse = (update: UpdateRow, ph: ProtocolHeaders, boundary: string) => {
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
    extensionsPart,
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
}) => {
  const { update, assetRows, scopeKey, assetBaseUrl, ph, boundary, useMultipart } = params;
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
    extensionsPart,
  ]);
};

// -- Rollout resolution ------------------------------------------------------

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

// -- Branch resolution -------------------------------------------------------

const resolveBranchId = (channel: ChannelRow, easClientId: string | undefined) => {
  const { branch_mapping_json: mapping } = channel;
  return mapping
    ? Effect.tryPromise(async () => evaluateBranchMapping(mapping, easClientId)).pipe(
        Effect.orElseSucceed(() => channel.branch_id),
      )
    : Effect.succeed(channel.branch_id);
};

// -- Response rendering (extracted to stay within max-statements) ------------

const buildUpdateResponse = (params: {
  readonly update: UpdateRow;
  readonly scopeKey: string;
  readonly ph: ProtocolHeaders;
}): Effect.Effect<Response, never, ManifestRepo> =>
  Effect.gen(function* () {
    const { update, scopeKey, ph } = params;
    const env = yield* cloudflareEnv;
    const boundary = crypto.randomUUID();
    const useMultipart = supportsMultipart(ph.accept ?? "*/*");

    if (update.is_rollback === 1) {
      if (!useMultipart) {
        return jsonError(406, "NOT_ACCEPTABLE", "Directive requires multipart/mixed");
      }
      return buildDirectiveResponse(update, ph, boundary);
    }

    if (update.manifest_body !== null) {
      const sig = signatureFor(ph, update);
      if (!useMultipart) {
        return jsonManifestResponse(update.manifest_body, sig);
      }
      return multipartResponse(boundary, [
        signedPart("manifest", update.manifest_body, sig),
        ...certChainParts(ph, update),
        extensionsPart,
      ]);
    }

    const repo = yield* ManifestRepo;
    const assetRows = yield* repo.findUpdateAssets({ updateId: update.id });
    return buildManifestFromData({
      update,
      assetRows,
      scopeKey,
      assetBaseUrl: env.ASSET_CDN_URL,
      ph,
      boundary,
      useMultipart,
    });
  });

// -- Cache check (extracted to stay within max-statements) -------------------

const openCache = () => Effect.promise(async () => caches.open(CACHE_NAME));

const checkCache = (cache: Cache, cacheKey: string) =>
  Effect.promise(async () => cache.match(cacheKey));

const isCacheable = (candidates: readonly UpdateRow[]) =>
  candidates.every((candidate) => candidate.rollout_percentage === 100);

const storeInCache = (
  cache: Cache,
  cacheKey: string,
  response: Response,
  meta: { readonly updateId: string; readonly responseType: ResponseType },
) =>
  Effect.gen(function* () {
    const ctx = yield* cloudflareCtx;
    ctx.waitUntil(cache.put(cacheKey, toCacheEntry(response, meta)));
  });

// -- Cache-miss resolution (extracted to stay within max-statements) ---------

const handleCacheMiss = (params: {
  readonly cache: Cache;
  readonly projectId: string;
  readonly resolvedBranchId: string;
  readonly cacheKey: string;
  readonly ph: ProtocolHeaders;
  readonly track: (branchId: string, updateId: string, responseType: ResponseType) => void;
}): Effect.Effect<Response, NotFound, ManifestRepo> =>
  Effect.gen(function* () {
    const { cache, projectId, resolvedBranchId, cacheKey, ph, track } = params;
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
      track(resolvedBranchId, "", "no_update");
      return noContent();
    }

    const update = yield* resolveRolledOutUpdate({
      candidates,
      easClientId: ph.easClientId,
      branchId: resolvedBranchId,
      platform: ph.platform,
      runtimeVersion: ph.runtimeVersion,
    });
    if (update === null) {
      track(resolvedBranchId, "", "no_update");
      return noContent();
    }

    const response = yield* buildUpdateResponse({ update, scopeKey, ph });
    const responseType: ResponseType = update.is_rollback === 1 ? "directive" : "manifest";
    track(resolvedBranchId, update.id, responseType);

    if (response.status === 200 && isCacheable(candidates)) {
      yield* storeInCache(cache, cacheKey, response, { updateId: update.id, responseType });
    }

    return response;
  });

// -- Resolution program ------------------------------------------------------

const serve = (request: Request, projectId: string): Effect.Effect<Response, never, ManifestRepo> =>
  Effect.gen(function* () {
    const startTime = Date.now();
    const env = yield* cloudflareEnv;
    const ph = yield* parseProtocolHeaders(request.headers);

    const track = (branchId: string, updateId: string, responseType: ResponseType) => {
      env.ANALYTICS.writeDataPoint({
        indexes: [`${projectId}:${ph.easClientId ?? crypto.randomUUID()}`],
        blobs: [
          projectId,
          ph.channelName,
          branchId,
          updateId,
          ph.platform,
          ph.runtimeVersion,
          responseType,
        ],
        doubles: [Date.now() - startTime, 0],
      });
    };

    const accept = ph.accept ?? "*/*";
    if (!supportsAny(accept)) {
      return jsonError(406, "NOT_ACCEPTABLE", "Supported: multipart/mixed, application/expo+json");
    }

    const repo = yield* ManifestRepo;
    const channel = yield* repo.resolveChannel({ projectId, channelName: ph.channelName });

    if (channel.is_paused === 1) {
      track(channel.branch_id, "", "no_update");
      return noContent();
    }

    const resolvedBranchId = yield* resolveBranchId(channel, ph.easClientId);

    const cacheKey = buildCacheKey({
      cacheVersion: channel.cache_version,
      projectId,
      channelName: ph.channelName,
      platform: ph.platform,
      runtimeVersion: ph.runtimeVersion,
      resolvedBranchId,
      multipart: supportsMultipart(ph.accept ?? "*/*"),
      expectSignature: Boolean(ph.expectSignature),
    });
    const cache = yield* openCache();
    const cached = yield* checkCache(cache, cacheKey);
    if (cached) {
      const updateId = cached.headers.get("x-cache-update-id") ?? "";
      // eslint-disable-next-line typescript/no-unsafe-type-assertion -- internal header written by toCacheEntry
      const responseType = (cached.headers.get("x-cache-response-type") ??
        "manifest") as ResponseType;
      track(resolvedBranchId, updateId, responseType);
      return fromCacheEntry(cached);
    }

    return yield* handleCacheMiss({ cache, projectId, resolvedBranchId, cacheKey, ph, track });
  }).pipe(
    // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect error handler, not a callback
    Effect.catchTag("BadRequest", (err) =>
      Effect.succeed(jsonError(400, "BAD_REQUEST", err.message)),
    ),
    // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect error handler, not a callback
    Effect.catchTag("NotFound", (err) => Effect.succeed(jsonError(404, "NOT_FOUND", err.message))),
  );

// -- Public entry point ------------------------------------------------------

export const serveManifest = async (request: Request, projectId: string): Promise<Response> =>
  Effect.runPromise(serve(request, projectId).pipe(Effect.provide(ManifestRepoLive)));
