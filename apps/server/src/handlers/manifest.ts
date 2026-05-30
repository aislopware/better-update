import { Effect, Match } from "effect";

import type { BadRequest, NotFound } from "@better-update/api";

import { provideCloudflareRequestContext } from "../cloudflare/context";
import { manifestRuntime } from "../cloudflare/manifest-runtime";
import { matchesFilters, skipFailedUpdates } from "../domain/manifest-filters";
import { deriveScopeKey } from "../domain/scope-key";
import {
  dropUnsignedWhenExpected,
  isUnsignedButSignatureExpected,
} from "../domain/signature-policy";
import { resolveUpdateRollout } from "../domain/update-rollout";
import { parseProtocolHeaders } from "../protocol/headers";
import { parseManifestFiltersJson } from "../protocol/sfv";
import { ManifestRepo } from "../repositories/manifest";
import { ProjectProtocolMetadataRepo } from "../repositories/project-protocol-metadata";
import { resolveBranchId } from "./branch-resolution";
import { buildCacheKey, matchCachedResponse, storeCachedResponse } from "./manifest-cache";
import { respond, responseTypeFor } from "./manifest-helpers";
import { ManifestServicesLive } from "./manifest-layer";
import {
  buildDirectiveResponse,
  buildManifestFromData,
  certChainParts,
  extensionsPart,
  jsonError,
  jsonManifestResponse,
  multipartResponse,
  noContent,
  parseJson,
  signatureFor,
  signedPart,
  supportsAny,
  supportsMultipart,
} from "./manifest-render";

import type { CryptoService } from "../domain/crypto-service";
import type { ProtocolHeaders } from "../protocol/headers";
import type { ChannelRow, UpdateRow } from "../repositories/manifest";
import type { ManifestFilters, TrackManifestResponse } from "./manifest-helpers";
import type { ManifestCacheStorage } from "./manifest-layer";

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
    // dropUnsignedWhenExpected then removes unsigned candidates when the client
    // sent `expo-expect-signature` — serving them unsigned would HARD-FAIL its
    // on-device signature verifier (see domain/signature-policy.ts). Absent the
    // header it is identity.
    const servable = dropUnsignedWhenExpected(
      skipFailedUpdates(matching, ph.recentFailedUpdateIds),
      ph.expectSignature,
    );

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
    // The rollout fallback (resolveFullyRolledOutUpdate) re-queries D1 and bypasses
    // the in-memory servable narrowing, so re-assert the same invariants on the
    // final pick: reported-failed, filter-excluded, OR unsigned-while-signature-
    // expected (a code-signing client hard-fails on an unsigned manifest) => 204.
    if (
      ph.recentFailedUpdateIds.includes(update.id) ||
      !matchesFilters(parseJson(update.metadata_json), filters) ||
      isUnsignedButSignatureExpected(update, ph.expectSignature)
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
