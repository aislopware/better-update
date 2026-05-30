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

// Full bundles are content-addressed by hash — identical for every requester —
// so they are safe to cache forever.
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

// A-IM content negotiation means this ONE bundle URL returns DIFFERENT bodies
// depending on whether the client advertised `a-im: bsdiff` and which base update
// it holds. Without protection, a cache could replay a cached PATCH body for a
// later FULL (no-`a-im`) request — the device would treat the bsdiff patch as a
// full bundle, fail its SHA-256 integrity check, and brick the update.
//
// TWO layers defend against this, because no single one covers every cache:
//   - `Vary` (here) is honored by standards-compliant intermediaries and the
//     Android OkHttp client cache, keeping a patch entry from being reused for the
//     fallback request.
//   - `no-store` on patch responses (below) is what protects the CLOUDFLARE EDGE,
//     which IGNORES `Vary` on non-`accept-encoding` headers.
// Full bundles are content-addressed (byte-identical for every requester) and stay
// immutable-cacheable.
const BUNDLE_VARY = "a-im, expo-current-update-id, expo-embedded-update-id";

// Patch bodies are negotiated per-request (the base depends on what the device
// currently holds), so no shared cache may ever treat one as reusable. `no-store`
// is the load-bearing edge protection (the Cloudflare edge ignores `Vary` on these
// custom headers); `BUNDLE_VARY` additionally guards Vary-honoring caches.
const PATCH_CACHE_CONTROL = "no-store";

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
    vary: BUNDLE_VARY,
    // A patch passes `cache-control: no-store` via extraHeaders, overriding the
    // immutable default below; full bundles keep it.
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
        { ...patchResponseHeaders(resolution.baseUpdateId), "cache-control": PATCH_CACHE_CONTROL },
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
