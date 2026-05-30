import { Effect, Layer, Match } from "effect";

import { resolveBundle } from "../application/resolve-bundle";
import { provideCloudflareEnv } from "../cloudflare/context";
import { parsePatchRequest, patchResponseHeaders } from "../protocol/patch-negotiation";
import { BundleRepoLive, ManifestRepoLive } from "../repositories";

import type { BundleResolution } from "../application/resolve-bundle";

// Imperative shell for the Expo OTA bundle route (RFC-3229 / A-IM bsdiff
// content negotiation). The launch asset URL in the manifest now points here
// (see protocol/manifest-builder.ts) so the Worker — not the CDN — can decide
// whether to serve a precomputed bsdiff patch or the full bundle.
//
// Pure selection (which base id, the R2 key, patch-vs-full) lives in protocol/
// + application/resolve-bundle.ts; this handler only parses the request,
// resolves the decision, and turns it into a Response. No throw — misses map to
// a 404 Response.

// Bundle/patch bodies are opaque binary. application/octet-stream is the
// content-type the zone Compression Rule targets (see P4 / the ops doc).
const BUNDLE_CONTENT_TYPE = "application/octet-stream";

// Patches are immutable per (from, to) and full bundles are content-addressed
// by hash, so both are safe to cache forever.
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

const notFoundResponse = (): Response =>
  Response.json({ code: "NOT_FOUND", message: "Bundle not found" }, { status: 404 });

// IMPORTANT: do NOT set `content-encoding` on bundle/patch responses.
// zstd/gzip is applied at the Cloudflare edge via the zone Compression Rule
// (Android FileDownloader decodes zstd as of expo-updates 56.0.14). Setting
// content-encoding here would mark the body as already-encoded and block the
// edge from compressing it. See docs/specs/server/19-bundle-diffing.md.
const blobResponse = (
  blob: { readonly body: ReadableStream | null; readonly size: number },
  extraHeaders: Readonly<Record<string, string>>,
  // RFC-3229 status. 200 by default; a patch may opt into 226 IM Used (see
  // toResponse / EMIT_HTTP_226). Both are 2xx and the device accepts either.
  status = 200,
): Response => {
  const headers = new Headers({
    "content-type": BUNDLE_CONTENT_TYPE,
    "cache-control": IMMUTABLE_CACHE_CONTROL,
    "content-length": blob.size.toString(),
    ...extraHeaders,
  });
  return new Response(blob.body, { status, headers });
};

// HTTP 226 "IM Used" (RFC 3229): the response is a delta (bsdiff patch) of the
// requested instance. Opt-in only — 200 stays the default for patches.
const HTTP_226_IM_USED = 226;

// Pure status selection: 226 ONLY for kind:"patch" when the opt-in flag is set;
// 200 for full bundles always, and for patches when the flag is off. patchResponseHeaders (im:bsdiff + expo-base-update-id) is identical either way.
export const toResponse = (emit226: boolean) =>
  Match.type<BundleResolution>().pipe(
    Match.discriminator("kind")("not-found", () => notFoundResponse()),
    Match.discriminator("kind")("patch", (resolution) =>
      blobResponse(
        resolution.blob,
        patchResponseHeaders(resolution.baseUpdateId),
        emit226 ? HTTP_226_IM_USED : 200,
      ),
    ),
    Match.discriminator("kind")("full", (resolution) => blobResponse(resolution.blob, {})),
    Match.exhaustive,
  );

const BundleServicesLive = Layer.mergeAll(ManifestRepoLive, BundleRepoLive);

const resolve = (request: Request, projectId: string, updateId: string) =>
  resolveBundle({
    request: parsePatchRequest(request.headers),
    projectId,
    updateId,
  }).pipe(Effect.provide(BundleServicesLive));

export const handleBundleRequest = async (
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  projectId: string,
  updateId: string,
): Promise<Response> => {
  const resolution = await Effect.runPromise(
    provideCloudflareEnv(resolve(request, projectId, updateId), env),
  );
  // Opt-in 226 emission, gated by the EMIT_HTTP_226 var (Cloudflare vars are
  // strings). Default "false"/absent -> 200 for patches. Only affects the
  // status line; the patch headers + body are identical to the 200 path.
  return toResponse(env.EMIT_HTTP_226 === "true")(resolution);
};
