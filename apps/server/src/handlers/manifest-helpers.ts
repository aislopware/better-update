import { Effect } from "effect";

import { cloudflareCtx } from "../cloudflare/context";
import { serializeManifestFilters } from "../protocol/sfv";
import { ProjectProtocolMetadataRepo } from "../repositories/project-protocol-metadata";

import type { ProtocolHeaders } from "../protocol/headers";
import type { UpdateRow } from "../repositories/manifest";
import type { ResponseType } from "./manifest-cache";

export type ManifestFilters = Record<string, string | number | boolean>;

export type TrackManifestResponse = (
  branchId: string,
  updateId: string,
  responseType: ResponseType,
) => void;

export const responseTypeFor = (update: Pick<UpdateRow, "is_rollback">): ResponseType =>
  update.is_rollback === 1 ? "directive" : "manifest";

// respond() records the device's echoed extra-params per (projectId, scopeKey).
// NOTE on naming: the stored value is the CLIENT-echoed `expo-extra-params`, not
// server-AUTHORED server-defined-headers — the server does not author any
// server-defined headers. We persist it under the `expo-extra-params` key so the
// row shape is honest about being a client echo. The P1 selection-policy work
// must NOT treat this as server-owned targeting state.
//
// We deliberately DO NOT emit an `expo-server-defined-headers` RESPONSE header.
// Reflecting the client's own extra-params back is inert — the device sources
// extra-params from its OWN persisted store, never from server-defined-headers
// (FileDownloader keeps the two as separate stores) — and a `:base64:`
// byte-sequence value is OUTSIDE the Expo SFV-0 subset, so emitting it is a
// spec-malformed (if client-tolerated) header. Absent the header, the device
// keeps its existing stored map, which is the correct safe default.
//
// The persistence is BOOKKEEPING ONLY and must never affect manifest serving:
//   1. Failure isolation — the repo write goes through Effect.promise (a
//      rejection surfaces as an unrecoverable defect, not a typed error), and
//      serve()'s Effect.match only handles BadRequest|NotFound. We swallow any
//      cause (typed error OR defect) so a transient D1 hiccup on this
//      non-essential write can never fail the response.
//   2. Off the critical path — the write is handed to ctx.waitUntil and not
//      awaited, so it adds no latency to manifest serving (including the cache-
//      HIT path, which otherwise never touches D1). The worker stays alive until
//      the write settles.
const recordExtraParams = (params: {
  readonly projectId: string;
  readonly scopeKey: string;
  readonly extraParams: ProtocolHeaders["extraParams"];
}): Effect.Effect<void, never, ProjectProtocolMetadataRepo> =>
  Effect.gen(function* () {
    const ctx = yield* cloudflareCtx;
    // Capture the live request context (CloudflareEnv + the resolved repo layer)
    // so the detached write keeps its env/service bindings when run on its own
    // fiber via ctx.waitUntil.
    const context = yield* Effect.context<ProjectProtocolMetadataRepo>();
    const write = Effect.gen(function* () {
      const repo = yield* ProjectProtocolMetadataRepo;
      yield* repo.upsertServerDefinedHeaders({
        projectId: params.projectId,
        scopeKey: params.scopeKey,
        serverDefinedHeadersJson: JSON.stringify({ "expo-extra-params": params.extraParams }),
      });
    }).pipe(
      Effect.catchAllCause(() => Effect.void),
      Effect.provide(context),
    );
    ctx.waitUntil(Effect.runPromise(write));
  });

// EMIT expo-manifest-filters as a stateless response-time decoration. The
// filters are the already-parsed per-(project,
// scopeKey) scalar map from the P0c store (read ONCE in serveRequest, threaded
// down, not re-read here). When undefined/empty we set NO header — the safe
// default: the client treats absent filters as `nil` => every update passes
// (identical to today). Applied at the single exit so a cache HIT also re-emits
// the CURRENT filters (the cached body never carries this header).
const emitManifestFilters = (
  response: Response,
  filters: ManifestFilters | undefined,
): Response => {
  if (filters === undefined) {
    return response;
  }
  const serialized = serializeManifestFilters(filters);
  if (serialized.length === 0) {
    return response;
  }
  response.headers.set("expo-manifest-filters", serialized);
  return response;
};

export const respond = (
  response: Response,
  ph: ProtocolHeaders,
  params: {
    readonly projectId: string;
    readonly scopeKey: string;
    readonly filters: ManifestFilters | undefined;
  },
) =>
  Effect.gen(function* () {
    if (ph.extraParams !== undefined) {
      yield* recordExtraParams({
        projectId: params.projectId,
        scopeKey: params.scopeKey,
        extraParams: ph.extraParams,
      });
    }
    return emitManifestFilters(response, params.filters);
  });
