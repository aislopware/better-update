import { safeJsonParse } from "@better-update/safe-json";
import { isRecord } from "@better-update/type-guards";
import { Effect, Match } from "effect";

import type { BadRequest, NotFound } from "@better-update/api";

import { provideCloudflareRequestContext } from "../cloudflare/context";
import { manifestRuntime } from "../cloudflare/manifest-runtime";
import { matchesFilters, skipFailedUpdates } from "../domain/manifest-filters";
import { deriveScopeKey } from "../domain/scope-key";
import { resolveUpdateRollout } from "../domain/update-rollout";
import { toOptional } from "../lib/nullable";
import { parseProtocolHeaders } from "../protocol/headers";
import { buildDirective, buildExtensions, buildManifest } from "../protocol/manifest-builder";
import { encodeMultipart } from "../protocol/multipart";
import { parseManifestFiltersJson } from "../protocol/sfv";
import { ManifestRepo } from "../repositories/manifest";
import { ProjectProtocolMetadataRepo } from "../repositories/project-protocol-metadata";
import { resolveBranchId } from "./branch-resolution";
import { buildCacheKey, matchCachedResponse, storeCachedResponse } from "./manifest-cache";
import { respond, responseTypeFor } from "./manifest-helpers";
import { ManifestServicesLive } from "./manifest-layer";

import type { CryptoService } from "../domain/crypto-service";
import type { ProtocolHeaders } from "../protocol/headers";
import type { Part } from "../protocol/multipart";
import type { AssetRow, ChannelRow, UpdateRow } from "../repositories/manifest";
import type { ManifestFilters, TrackManifestResponse } from "./manifest-helpers";
import type { ManifestCacheStorage } from "./manifest-layer";

// Do not set `content-encoding` on manifest responses — Cloudflare edge applies
// zstd/gzip via the zone Compression Rule; manual encoding blocks it. The
// content-types here (multipart/mixed, application/expo+json) are set per-response.
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

const signatureFor = (ph: ProtocolHeaders, update: UpdateRow) =>
  ph.expectSignature ? toOptional(update.signature) : undefined;
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
  const parsed = safeJsonParse(raw);
  return isRecord(parsed) ? parsed : {};
};

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
  readonly assetBaseUrl: string;
  readonly serverBaseUrl: string;
  readonly projectId: string;
  readonly ph: ProtocolHeaders;
  readonly boundary: string;
  readonly useMultipart: boolean;
}) => {
  const { update, assetRows, assetBaseUrl, serverBaseUrl, projectId, ph, boundary, useMultipart } =
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
        contentChecksum: row.content_checksum,
        contentType: row.content_type,
        fileExt: row.file_ext,
        isLaunch: row.is_launch === 1,
      })),
      assetBaseUrl,
      // Launch asset URL points at the Worker bundle route so the Worker can
      // negotiate bsdiff patches (see protocol/manifest-builder.ts).
      serverBaseUrl,
      projectId,
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
}): Effect.Effect<UpdateRow | null, never, ManifestRepo | CryptoService> =>
  Effect.gen(function* () {
    const rolloutResult = yield* resolveUpdateRollout(params.candidates, params.easClientId).pipe(
      Effect.orDie,
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

const buildUpdateResponse = (params: {
  readonly update: UpdateRow;
  readonly projectId: string;
  readonly ph: ProtocolHeaders;
}): Effect.Effect<Response, never, ManifestRepo> =>
  Effect.gen(function* () {
    const { update, projectId, ph } = params;
    const runtime = yield* manifestRuntime;
    const boundary = crypto.randomUUID();
    const useMultipart = supportsMultipart(ph.accept ?? "*/*");

    if (update.is_rollback === 1) {
      if (!useMultipart) {
        return jsonError(406, "NOT_ACCEPTABLE", "Directive requires multipart/mixed");
      }
      return buildDirectiveResponse(update, ph, boundary);
    }

    if (update.manifest_body !== null) {
      // Serve stored manifest_body BYTE-FOR-BYTE — the exact bytes verified at
      // publish (domain/signed-update-verification.ts); never re-rendered.
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
      assetBaseUrl: runtime.assetBaseUrl,
      serverBaseUrl: runtime.serverBaseUrl,
      projectId,
      ph,
      boundary,
      useMultipart,
    });
  });
const isCacheable = (candidates: readonly UpdateRow[]) =>
  candidates.every((candidate) => candidate.rollout_percentage === 100);

const handleCacheMiss = (params: {
  readonly projectId: string;
  readonly resolvedBranchId: string;
  readonly cacheKey: string;
  readonly ph: ProtocolHeaders;
  readonly filters: ManifestFilters | undefined;
  readonly track: TrackManifestResponse;
}): Effect.Effect<Response, NotFound, ManifestRepo | ManifestCacheStorage | CryptoService> =>
  Effect.gen(function* () {
    const { projectId, resolvedBranchId, cacheKey, ph, filters, track } = params;
    const repo = yield* ManifestRepo;

    const candidates = yield* repo.resolveUpdates({
      branchId: resolvedBranchId,
      platform: ph.platform,
      runtimeVersion: ph.runtimeVersion,
    });

    // EXISTING guard: nothing for this (branch, platform, runtime) at all.
    if (candidates.length === 0) {
      return trackNoUpdate(resolvedBranchId, track);
    }

    // ANTI-BRICK narrowing (pure, total, never throws). matchesFilters with
    // undefined filters OR undefined metadata returns true, so the no-filter /
    // no-metadata default is permissive — it can only drop updates whose
    // metadata explicitly contradicts a configured server-policy filter.
    const matching = candidates.filter((candidate) =>
      matchesFilters(parseJson(candidate.metadata_json), filters),
    );
    // skipFailedUpdates removes ONLY the ids the device itself just reported as
    // failed; empty recentFailedUpdateIds is identity. The result may be [].
    const servable = skipFailedUpdates(matching, ph.recentFailedUpdateIds);

    // NEVER-STRAND backstop: if every LIMIT-2 candidate (latest + previous) was
    // filtered out or reported-failed, return 204 (keep running what you have),
    // NOT an error and NOT an empty/garbage manifest. The device's own
    // ErrorRecovery then falls back to its last-known-good / embedded update.
    if (servable.length === 0) {
      return trackNoUpdate(resolvedBranchId, track);
    }

    const update = yield* resolveRolledOutUpdate({
      candidates: servable,
      easClientId: ph.easClientId,
      branchId: resolvedBranchId,
      platform: ph.platform,
      runtimeVersion: ph.runtimeVersion,
    });
    if (update === null) {
      return trackNoUpdate(resolvedBranchId, track);
    }

    // FINAL anti-brick guard. resolveRolledOutUpdate's rollout-fallback branch
    // re-queries D1 (resolveFullyRolledOutUpdate) for the latest 100%-rollout
    // row, which BYPASSES the in-memory servable narrowing above. So the chosen
    // update — if it came from that fallback — could be a reported-failed or
    // filter-excluded update. Re-assert both invariants on the final pick: if it
    // is reported-failed or fails the filter, return 204 (never serve it). The
    // common direct-pick path (update is already in `servable`) passes trivially.
    if (
      ph.recentFailedUpdateIds.includes(update.id) ||
      !matchesFilters(parseJson(update.metadata_json), filters)
    ) {
      return trackNoUpdate(resolvedBranchId, track);
    }

    if (ph.currentUpdateId && update.id === ph.currentUpdateId) {
      return trackNoUpdate(resolvedBranchId, track);
    }

    const response = yield* buildUpdateResponse({ update, projectId, ph });
    const responseType = responseTypeFor(update);
    track(resolvedBranchId, update.id, responseType);

    // A per-device skip result must NOT poison the shared per-tenant cache, so a
    // manifest produced while the device reported failed ids is never written.
    // (matchesFilters narrowing is tenant-scoped via scopeKey — already a cache
    // dimension — so it stays cacheable.)
    if (
      response.status === 200 &&
      ph.recentFailedUpdateIds.length === 0 &&
      isCacheable(candidates)
    ) {
      yield* storeCachedResponse(cacheKey, response, { updateId: update.id, responseType });
    }

    return response;
  });

const serveCachedOrFresh = (params: {
  readonly cacheVersion: number;
  readonly scopeKey: string;
  readonly projectId: string;
  readonly resolvedBranchId: string;
  readonly accept: string;
  readonly ph: ProtocolHeaders;
  readonly filters: ManifestFilters | undefined;
  readonly track: TrackManifestResponse;
}): Effect.Effect<Response, NotFound, ManifestRepo | ManifestCacheStorage | CryptoService> =>
  Effect.gen(function* () {
    const { cacheVersion, scopeKey, projectId, resolvedBranchId, accept, ph, filters, track } =
      params;
    const cacheKey = buildCacheKey({
      cacheVersion,
      scopeKey,
      projectId,
      channelName: ph.channelName,
      platform: ph.platform,
      runtimeVersion: ph.runtimeVersion,
      resolvedBranchId,
      multipart: supportsMultipart(accept),
      expectSignature: Boolean(ph.expectSignature),
    });
    const cached = yield* matchCachedResponse(cacheKey);
    // The shared cache only ever stores manifests produced with NO failed-ids
    // report (handleCacheMiss gates storeCachedResponse on
    // recentFailedUpdateIds.length === 0), so a cached entry can never itself be
    // poisoned. But a device that just reported the cached update as failed must
    // STILL not be served it: skip the HIT and fall through to handleCacheMiss,
    // which re-resolves over the live candidates with skipFailedUpdates applied
    // (and 204s if nothing is servable). matchesFilters narrowing stays handled
    // server-side too on this fall-through path.
    const cachedIsFailed = cached !== null && ph.recentFailedUpdateIds.includes(cached.updateId);
    if (cached && !cachedIsFailed) {
      if (ph.currentUpdateId && cached.updateId === ph.currentUpdateId) {
        track(resolvedBranchId, "", "no_update");
        return noContent();
      }
      track(resolvedBranchId, cached.updateId, cached.responseType);
      return cached.response;
    }
    return yield* handleCacheMiss({ projectId, resolvedBranchId, cacheKey, ph, filters, track });
  });

const resolveRequestResponse = (params: {
  readonly channel: ChannelRow;
  readonly scopeKey: string;
  readonly projectId: string;
  readonly resolvedBranchId: string;
  readonly accept: string;
  readonly ph: ProtocolHeaders;
  readonly filters: ManifestFilters | undefined;
  readonly track: TrackManifestResponse;
}): Effect.Effect<Response, NotFound, ManifestRepo | ManifestCacheStorage | CryptoService> => {
  const { channel, scopeKey, projectId, resolvedBranchId, accept, ph, filters, track } = params;
  return serveCachedOrFresh({
    cacheVersion: channel.cache_version,
    scopeKey,
    projectId,
    resolvedBranchId,
    accept,
    ph,
    filters,
    track,
  });
};

const serveRequest = (
  request: Request,
  projectId: string,
): Effect.Effect<
  Response,
  BadRequest | NotFound,
  ManifestRepo | ManifestCacheStorage | CryptoService | ProjectProtocolMetadataRepo
> =>
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

    // scopeKey is derived server-side, never read from a request header. Fall
    // back to the PUBLIC_API_URL origin for legacy rows whose scope_key is NULL
    // (see migration 0051) — derivation is total so this never throws.
    const scopeKey =
      channel.scope_key ??
      deriveScopeKey({ updateUrl: `${runtime.serverBaseUrl}/manifest/${projectId}` });

    // Load the per-(project, scopeKey) manifest-filters ONCE here: they are both
    // EMITTED on the response (respond) and applied server-side to candidate
    // selection (handleCacheMiss). undefined => no row / no scalar keys => no
    // header emitted + permissive matchesFilters (the safe default). The read is
    // a single D1 hit on the cache-miss-or-hit path either way.
    const metadataRepo = yield* ProjectProtocolMetadataRepo;
    const metadataRow = yield* metadataRepo.get({ projectId, scopeKey });
    const filters = parseManifestFiltersJson(metadataRow?.manifest_filters_json);

    if (channel.is_paused === 1) {
      return yield* respond(trackNoUpdate(channel.branch_id, track), ph, {
        projectId,
        scopeKey,
        filters,
      });
    }

    const resolvedBranchId = yield* resolveBranchId(channel, ph);
    const response = yield* resolveRequestResponse({
      channel,
      scopeKey,
      projectId,
      resolvedBranchId,
      accept,
      ph,
      filters,
      track,
    });
    return yield* respond(response, ph, { projectId, scopeKey, filters });
  });

const toManifestErrorResponse = Match.type<BadRequest | NotFound>().pipe(
  Match.tag("BadRequest", (error) => jsonError(400, "BAD_REQUEST", error.message)),
  Match.tag("NotFound", (error) => jsonError(404, "NOT_FOUND", error.message)),
  Match.exhaustive,
);

const serve = (
  request: Request,
  projectId: string,
): Effect.Effect<
  Response,
  never,
  ManifestRepo | ManifestCacheStorage | CryptoService | ProjectProtocolMetadataRepo
> =>
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
      serve(request, projectId).pipe(Effect.provide(ManifestServicesLive)),
      env,
      ctx,
      request,
    ),
  );
