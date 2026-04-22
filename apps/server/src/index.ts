import type { Context } from "effect";

import { makeManagementWebHandler } from "./app-layer";
import { createAuth, isGithubEnabled } from "./auth";
import { makeCloudflareRequestContext } from "./cloudflare/context";
import {
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

/**
 * Builds CORS response headers when the request's Origin matches a trusted
 * SPA subdomain. Non-SPA clients (CLI, mobile OTA) don't send matching
 * Origins and receive no CORS headers — they don't need them.
 */
const corsHeaders = (env: Env, origin: string | null): Record<string, string> => {
  if (!origin) {
    return {};
  }
  const allowed = [env.ACCOUNTS_URL, env.CONSOLE_URL].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  if (!allowed.includes(origin)) {
    return {};
  }
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers":
      "content-type, authorization, traceparent, tracestate, baggage, b3",
    "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    vary: "origin",
  };
};

const withCors = (response: Response, cors: Record<string, string>): Response => {
  if (Object.keys(cors).length === 0) {
    return response;
  }
  const headers = new Headers([...response.headers, ...Object.entries(cors)]);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

/** Handle Better Auth routes with workarounds for dev-mode status codes and empty bodies */
const handleAuth = async (request: Request, env: Env): Promise<Response> => {
  // eslint-disable-next-line functional/no-try-statements -- Better Auth may throw unhandled exceptions
  try {
    const response = await createAuth(env).handler(request);

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
  const origin = request.headers.get("origin");
  const cors = corsHeaders(env, origin);

  // CORS preflight — respond before any route matching
  if (request.method === "OPTIONS" && Object.keys(cors).length > 0) {
    return new Response(null, { status: 204, headers: cors });
  }

  const requestContext = makeCloudflareRequestContext(env, ctx, request) as Context.Context<never>;

  // Better Auth handles its own auth routes
  if (url.pathname.startsWith("/api/auth")) {
    return withCors(await handleAuth(request, env), cors);
  }

  // Public server capabilities — called by the accounts SPA before login
  // To decide which auth providers to render. Must stay unauthenticated.
  if (url.pathname === "/api/config" && request.method === "GET") {
    return withCors(
      Response.json({
        githubEnabled: isGithubEnabled(env),
      }),
      cors,
    );
  }

  // Expo Updates protocol — unauthenticated manifest serving
  const manifestMatch = /^\/manifest\/([^/]+)\/?$/.exec(url.pathname);
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
  return withCors(await handler(request, requestContext), cors);
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
