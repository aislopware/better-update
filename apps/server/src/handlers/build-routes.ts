import { createAuth } from "../auth";
import { verifyInstallToken } from "../domain/install-token";
import { generateDownloadUrl } from "../domain/presigned-url";

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
  }

  const artifact = await env.DB.prepare(
    `SELECT a."r2_key" FROM "build_artifacts" a WHERE a."build_id" = ?`,
  )
    .bind(buildId)
    .first<{ r2_key: string }>();
  if (!artifact) {
    return Response.json(
      { code: "NOT_FOUND", message: "Build artifact not found" },
      { status: 404 },
    );
  }

  const downloadUrl = await generateDownloadUrl(env, artifact.r2_key, 900);
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

  const row = await env.DB.prepare(
    `SELECT b."distribution", b."bundle_id", b."app_version", b."message", a."r2_key" FROM "builds" b JOIN "build_artifacts" a ON a."build_id" = b."id" WHERE b."id" = ?`,
  )
    .bind(buildId)
    .first<{
      distribution: string;
      bundle_id: string | null;
      app_version: string | null;
      message: string | null;
      r2_key: string;
    }>();

  if (!row) {
    return Response.json({ code: "NOT_FOUND", message: "Build not found" }, { status: 404 });
  }

  if (row.distribution !== "ad-hoc" && row.distribution !== "enterprise") {
    return Response.json(
      {
        code: "BAD_REQUEST",
        message: "Install plist only available for ad-hoc or enterprise distributions",
      },
      { status: 400 },
    );
  }

  const artifactUrl = await generateDownloadUrl(env, row.r2_key, 900);

  const bundleId = row.bundle_id ?? "com.unknown.app";
  const appVersion = row.app_version ?? "1.0.0";
  const title = row.message ?? "Build";

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
          <string>${artifactUrl}</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key>
        <string>${bundleId}</string>
        <key>bundle-version</key>
        <string>${appVersion}</string>
        <key>kind</key>
        <string>software</string>
        <key>title</key>
        <string>${title}</string>
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
