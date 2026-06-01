import type { Context } from "effect";

import { makeManagementWebHandler } from "./app-layer";
import { createAuth, isGithubEnabled, isGoogleEnabled } from "./auth";
import { makeCloudflareRequestContext } from "./cloudflare/context";
import {
  handleBundleRequest,
  handleScheduled,
  matchBuildRoute,
  matchDeviceRegistrationRoute,
  serveManifest,
} from "./handlers";
import { structuredLog } from "./middleware/logging";

export {
  CreateBranchCoordinator,
  PublishCoordinator,
} from "./durable-objects/publish-coordinators";
const { handler } = makeManagementWebHandler();

const internalError = () =>
  Response.json(
    { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" },
    { status: 500 },
  );

const handleHealth = async (env: Env): Promise<Response> => {
  const timestamp = new Date().toISOString();
  // Single SELECT 1 confirms D1 is reachable + responsive. Tolerate failure:
  // a degraded status is more useful than a 500 (clients can decide).
  // eslint-disable-next-line functional/no-try-statements -- catch all to map any binding/DB error into a degraded response without leaking internals
  try {
    await env.DB.prepare("SELECT 1").first();
    return Response.json({ status: "ok", timestamp });
  } catch (error) {
    structuredLog("warn", "Health probe failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ status: "degraded", timestamp }, { status: 503 });
  }
};

/** Handle Better Auth routes with workarounds for dev-mode status codes and empty bodies */
const handleAuth = async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
  // eslint-disable-next-line functional/no-try-statements -- Better Auth may throw unhandled exceptions
  try {
    const response = await createAuth(env, ctx).handler(request);

    // Workaround: @cloudflare/vite-plugin crashes on HTTP 401 from auxiliary
    // Workers (all other 4xx/5xx codes work). Remap 401 → 403 in dev + test,
    // I.e. any non-production environment. ENVIRONMENT is "production" for
    // Deployed Workers; TEST_MODE covers vitest + e2e harnesses that do not
    // Set ENVIRONMENT.
    const isDevOrTest = env.TEST_MODE === "true" || env.ENVIRONMENT !== "production";
    if (response.status === 401 && isDevOrTest) {
      const body = response.body ? await response.text() : null;
      return new Response(body, {
        status: 403,
        headers: response.headers,
      });
    }

    // Better-call returns null-body 500 for non-APIError exceptions (e.g. D1 errors);
    // Replace with a structured JSON body so the client always gets parseable output
    if (response.status >= 400 && !response.body) {
      return Response.json(
        { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" },
        { status: response.status },
      );
    }

    return response;
  } catch (error) {
    structuredLog("error", "Auth handler error", {
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
    });
    return internalError();
  }
};

const routeRequest = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> => {
  const url = new URL(request.url);
  const requestContext = makeCloudflareRequestContext(env, ctx, request) as Context.Context<never>;

  // Better Auth handles its own auth routes
  if (url.pathname.startsWith("/api/auth")) {
    return handleAuth(request, env, ctx);
  }

  // Public server capabilities — unauthenticated; called before login to
  // Decide which auth providers to render.
  if (url.pathname === "/api/config" && request.method === "GET") {
    // `assetCdnUrl` lets the CLI render a signed manifest's non-launch asset
    // URLs against the origin the Worker actually serves regular assets from
    // (there is no `/assets/{hash}` route on the API origin), keeping signed
    // updates' image/font/extra-chunk assets loadable on-device.
    return Response.json({
      githubEnabled: isGithubEnabled(env),
      googleEnabled: isGoogleEnabled(env),
      assetCdnUrl: env.ASSET_CDN_URL,
    });
  }

  // Public health probe — CLI/clients call this before long-running ops to
  // detect outages and warn the user fast. Light-weight; pings D1 to confirm
  // the database is reachable. Never throws — returns degraded status instead.
  if (url.pathname === "/api/health" && request.method === "GET") {
    return handleHealth(env);
  }

  // Expo Updates protocol — Worker-served launch bundle for bsdiff A-IM
  // content negotiation. Ordered before the manifest route (more specific
  // sub-path). projectId / updateId / hash; the hash is informational (the
  // launch asset is resolved by updateId), kept in the path so the URL is
  // content-addressed + cacheable.
  const bundleMatch = /^\/manifest\/([^/]+)\/bundle\/([^/]+)\/([^/]+)\/?$/u.exec(url.pathname);
  if (bundleMatch?.[1] && bundleMatch[2] && request.method === "GET") {
    return handleBundleRequest(request, env, ctx, bundleMatch[1], bundleMatch[2]);
  }

  // Expo Updates protocol — unauthenticated manifest serving
  const manifestMatch = /^\/manifest\/([^/]+)\/?$/u.exec(url.pathname);
  if (manifestMatch?.[1]) {
    return serveManifest(request, env, ctx, manifestMatch[1]);
  }

  // Build routes — artifact download + iOS install plist
  const buildResponse = await matchBuildRoute(request, env, url.pathname);
  if (buildResponse) {
    return buildResponse;
  }

  // Device registration — Safari + mobileconfig flow (no auth)
  const registrationResponse = await matchDeviceRegistrationRoute(request, env, url.pathname);
  if (registrationResponse) {
    return registrationResponse;
  }

  // Effect HttpApi handles management routes + OpenAPI + Scalar docs
  return handler(request, requestContext);
};

export default {
  async fetch(request, env, ctx) {
    // eslint-disable-next-line functional/no-try-statements -- imperative shell error boundary
    try {
      return await routeRequest(request, env, ctx);
    } catch (error) {
      structuredLog("error", "Unhandled request error", {
        method: request.method,
        path: new URL(request.url).pathname,
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      });
      return internalError();
    }
  },

  scheduled(_event, env, ctx) {
    ctx.waitUntil(handleScheduled(env));
  },
} satisfies ExportedHandler<Env>;
