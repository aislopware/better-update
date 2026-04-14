import { Effect } from "effect";

import { createAuth } from "../auth";
import { BuildRuntime } from "../cloudflare/build-runtime";
import { provideCloudflareEnv } from "../cloudflare/context";
import { verifyInstallToken } from "../domain/install-token";
import { ServerInfrastructureLayer } from "../infrastructure-layer";
import { BuildRepo } from "../repositories";

import type { ServerInfrastructure } from "../infrastructure-layer";

const runBuildRouteEffect = async <Success, Failure>(
  effect: Effect.Effect<Success, Failure, ServerInfrastructure>,
  env: Env,
) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(ServerInfrastructureLayer), (program) =>
      provideCloudflareEnv(program, env),
    ),
  );

const findArtifactR2KeyByIdAndOrg = (buildId: string, organizationId: string) =>
  Effect.gen(function* () {
    const repo = yield* BuildRepo;
    return yield* repo.findArtifactR2KeyByIdAndOrg({ id: buildId, organizationId });
  });

const findArtifactR2KeyById = (buildId: string) =>
  Effect.gen(function* () {
    const repo = yield* BuildRepo;
    return yield* repo.findArtifactR2KeyById({ id: buildId });
  });

const findInstallInfoById = (buildId: string) =>
  Effect.gen(function* () {
    const repo = yield* BuildRepo;
    return yield* repo.findInstallInfoById({ id: buildId });
  });

const getBuildObject = (key: string) =>
  Effect.gen(function* () {
    const runtime = yield* BuildRuntime;
    return yield* runtime.getObject({ key });
  });

const putBuildObject = (params: {
  readonly key: string;
  readonly body: ReadableStream | Uint8Array;
  readonly contentType: string;
}) =>
  Effect.gen(function* () {
    const runtime = yield* BuildRuntime;
    yield* runtime.putObject(params);
  });

const createBuildDownloadUrl = (key: string) =>
  Effect.gen(function* () {
    const runtime = yield* BuildRuntime;
    return yield* runtime.createDownloadUrl({ key, expiresIn: 900 });
  });

const testBuildStorageUrl = (request: Request, mode: "upload" | "download", key: string) => {
  const url = new URL(request.url);
  url.pathname = mode === "upload" ? "/__test/build-upload" : "/__test/build-download";
  url.search = "";
  url.searchParams.set("key", key);
  return url.toString();
};

const resolveBuildDownloadUrl = async (request: Request, env: Env, key: string) =>
  env.TEST_MODE === "true"
    ? testBuildStorageUrl(request, "download", key)
    : runBuildRouteEffect(createBuildDownloadUrl(key), env);

const escapeXml = (str: string) =>
  str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const verifySignedToken = async (
  buildId: string,
  token: string | null,
  expires: string | null,
  secret: string,
): Promise<boolean> => {
  if (!token || !expires) {
    return false;
  }
  const expiresNum = Number.parseInt(expires, 10);
  return verifyInstallToken(buildId, token, expiresNum, secret);
};

export const handleBuildArtifactDownload = async (
  request: Request,
  env: Env,
  buildId: string,
): Promise<Response> => {
  const url = new URL(request.url);
  const tokenValid = env.INSTALL_TOKEN_SECRET
    ? await verifySignedToken(
        buildId,
        url.searchParams.get("token"),
        url.searchParams.get("expires"),
        env.INSTALL_TOKEN_SECRET,
      )
    : false;

  if (!tokenValid) {
    const auth = createAuth(env);
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return Response.json(
        { code: "UNAUTHORIZED", message: "Authentication required" },
        { status: 401 },
      );
    }

    const orgId = session.session.activeOrganizationId;
    if (!orgId) {
      return Response.json(
        { code: "FORBIDDEN", message: "Organization context required" },
        { status: 403 },
      );
    }

    const r2Key = await runBuildRouteEffect(findArtifactR2KeyByIdAndOrg(buildId, orgId), env);
    if (!r2Key) {
      return Response.json(
        { code: "NOT_FOUND", message: "Build artifact not found" },
        { status: 404 },
      );
    }

    const downloadUrl = await resolveBuildDownloadUrl(request, env, r2Key);
    return Response.redirect(downloadUrl, 302);
  }

  const r2Key = await runBuildRouteEffect(findArtifactR2KeyById(buildId), env);
  if (!r2Key) {
    return Response.json(
      { code: "NOT_FOUND", message: "Build artifact not found" },
      { status: 404 },
    );
  }

  const downloadUrl = await resolveBuildDownloadUrl(request, env, r2Key);
  return Response.redirect(downloadUrl, 302);
};

export const handleBuildInstallPlist = async (
  request: Request,
  env: Env,
  buildId: string,
): Promise<Response> => {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const expires = url.searchParams.get("expires");

  if (!token || !expires || !env.INSTALL_TOKEN_SECRET) {
    return Response.json(
      { code: "UNAUTHORIZED", message: "Signed token required" },
      { status: 401 },
    );
  }

  const expiresNum = Number.parseInt(expires, 10);
  const valid = await verifyInstallToken(buildId, token, expiresNum, env.INSTALL_TOKEN_SECRET);
  if (!valid) {
    return Response.json(
      { code: "UNAUTHORIZED", message: "Invalid or expired token" },
      { status: 401 },
    );
  }

  const build = await runBuildRouteEffect(findInstallInfoById(buildId), env);

  if (!build) {
    return Response.json({ code: "NOT_FOUND", message: "Build not found" }, { status: 404 });
  }

  if (build.distribution !== "ad-hoc" && build.distribution !== "enterprise") {
    return Response.json(
      {
        code: "BAD_REQUEST",
        message: "Install plist only available for ad-hoc or enterprise distributions",
      },
      { status: 400 },
    );
  }

  const artifactUrl = await resolveBuildDownloadUrl(request, env, build.r2Key);

  const bundleId = build.bundleId ?? "com.unknown.app";
  const appVersion = build.appVersion ?? "1.0.0";
  const title = build.message ?? "Build";

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key>
          <string>software-package</string>
          <key>url</key>
          <string>${escapeXml(artifactUrl)}</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key>
        <string>${escapeXml(bundleId)}</string>
        <key>bundle-version</key>
        <string>${escapeXml(appVersion)}</string>
        <key>kind</key>
        <string>software</string>
        <key>title</key>
        <string>${escapeXml(title)}</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>`;

  return new Response(plist, {
    headers: { "content-type": "application/xml" },
  });
};

const handleTestBuildUpload = async (request: Request, env: Env): Promise<Response> => {
  if (env.TEST_MODE !== "true") {
    return Response.json({ code: "NOT_FOUND", message: "Not found" }, { status: 404 });
  }

  const key = new URL(request.url).searchParams.get("key");
  if (!key) {
    return Response.json(
      { code: "BAD_REQUEST", message: "Missing build object key" },
      { status: 400 },
    );
  }

  await runBuildRouteEffect(
    putBuildObject({
      key,
      body: request.body ?? new Uint8Array(),
      contentType: request.headers.get("content-type") ?? "application/octet-stream",
    }),
    env,
  );

  return new Response(null, { status: 200 });
};

const handleTestBuildDownload = async (request: Request, env: Env): Promise<Response> => {
  if (env.TEST_MODE !== "true") {
    return Response.json({ code: "NOT_FOUND", message: "Not found" }, { status: 404 });
  }

  const key = new URL(request.url).searchParams.get("key");
  if (!key) {
    return Response.json(
      { code: "BAD_REQUEST", message: "Missing build object key" },
      { status: 400 },
    );
  }

  const object = await runBuildRouteEffect(getBuildObject(key), env);
  if (!object) {
    return Response.json({ code: "NOT_FOUND", message: "Build object not found" }, { status: 404 });
  }

  const headers = new Headers();
  headers.set("content-type", object.contentType ?? "application/octet-stream");
  headers.set("content-length", object.size.toString());
  headers.set("cache-control", "no-store");
  return new Response(object.body, { headers });
};

export const matchBuildRoute = async (
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response | null> => {
  if (pathname === "/__test/build-upload" && request.method === "PUT") {
    return handleTestBuildUpload(request, env);
  }

  if (pathname === "/__test/build-download" && request.method === "GET") {
    return handleTestBuildDownload(request, env);
  }

  const artifactMatch = /^\/api\/builds\/([^/]+)\/artifact$/.exec(pathname);
  if (artifactMatch?.[1] && request.method === "GET") {
    return handleBuildArtifactDownload(request, env, artifactMatch[1]);
  }

  const installMatch = /^\/api\/builds\/([^/]+)\/install$/.exec(pathname);
  if (installMatch?.[1] && request.method === "GET") {
    return handleBuildInstallPlist(request, env, installMatch[1]);
  }

  return null;
};
