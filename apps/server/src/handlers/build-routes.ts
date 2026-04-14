import { Effect } from "effect";

import { createAuth } from "../auth";
import { BuildRuntime } from "../cloudflare/build-runtime";
import { provideCloudflareEnv } from "../cloudflare/context";
import { verifyInstallToken } from "../domain/install-token";
import { ServerInfrastructureLayer } from "../infrastructure-layer";
import { BuildRepo } from "../repositories";

import type { ServerInfrastructure } from "../infrastructure-layer";

const runBuildRouteEffect = async <Success, Error>(
  effect: Effect.Effect<Success, Error, ServerInfrastructure>,
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

const createBuildDownloadUrl = (key: string) =>
  Effect.gen(function* () {
    const runtime = yield* BuildRuntime;
    return yield* runtime.createDownloadUrl({ key, expiresIn: 900 });
  });

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

    const downloadUrl = await runBuildRouteEffect(createBuildDownloadUrl(r2Key), env);
    return Response.redirect(downloadUrl, 302);
  }

  const r2Key = await runBuildRouteEffect(findArtifactR2KeyById(buildId), env);
  if (!r2Key) {
    return Response.json(
      { code: "NOT_FOUND", message: "Build artifact not found" },
      { status: 404 },
    );
  }

  const downloadUrl = await runBuildRouteEffect(createBuildDownloadUrl(r2Key), env);
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

  const artifactUrl = await runBuildRouteEffect(createBuildDownloadUrl(build.r2Key), env);

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

export const matchBuildRoute = async (
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response | null> => {
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
