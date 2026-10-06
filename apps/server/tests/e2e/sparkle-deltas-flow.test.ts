import { createHash } from "node:crypto";

import { env } from "cloudflare:workers";

import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { del, get, parseCookies, post } = setupE2EWorker(".wrangler/state/e2e-sparkle-deltas");

/**
 * Sparkle binary deltas through the real Worker + D1: reserving and
 * completing a delta upload for a macOS build, the refusals (installer
 * packages, other platforms, a delta to itself, a completion that does not
 * match its reservation), `<sparkle:deltas>` in the appcast, the download
 * redirect it points at, replacing a delta, and deleting a build's deltas with
 * the build.
 */
describe("Sparkle deltas flow", () => {
  let cookies: string;
  let organizationId: string;
  let projectId: string;
  let buildId: string;
  let pkgBuildId: string;
  let windowsBuildId: string;
  let releaseId: string;

  const edSignature = Buffer.alloc(64, 7).toString("base64");
  const deltaSignature = Buffer.alloc(64, 9).toString("base64");

  const completedBuild = async (body: Record<string, unknown>) => {
    const bytes = Buffer.from(`sparkle delta e2e ${JSON.stringify(body)}`);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const reserved = await post(
      "/api/builds",
      { projectId, sha256, byteSize: bytes.byteLength, bundleId: "com.example.desktop", ...body },
      { cookie: cookies },
    );
    expect(reserved.status).toBe(201);
    const { id } = await reserved.json<{ id: string }>();
    const complete = await post(
      `/api/builds/${id}/complete`,
      { sha256, byteSize: bytes.byteLength },
      { cookie: cookies },
    );
    expect(complete.status).toBe(200);
    return { id, sha512: createHash("sha512").update(bytes).digest("base64") };
  };

  const deltaBody = (deltaFrom: string, content: string) => {
    const bytes = Buffer.from(content);
    return {
      deltaFrom,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteSize: bytes.byteLength,
    };
  };

  const storedKey = async (deltaId: string) => {
    const row = await env.DB.prepare('SELECT "r2_key" FROM "desktop_build_deltas" WHERE "id" = ?')
      .bind(deltaId)
      .first<{ r2_key: string }>();
    return row?.r2_key ?? "";
  };

  it("bootstraps a user, organization, project and builds", async () => {
    const signUp = await post("/api/auth/sign-up/email", {
      name: "Sparkle Delta User",
      email: "sparkle-delta-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(signUp.status).toBe(200);
    cookies = parseCookies(signUp);
    const org = await post(
      "/api/auth/organization/create",
      { name: "Sparkle Delta Org", slug: "sparkle-delta-org" },
      { cookie: cookies },
    );
    expect(org.status).toBe(200);
    ({ id: organizationId } = await org.json<{ id: string }>());
    cookies = parseCookies(org) || cookies;
    const active = await post(
      "/api/auth/organization/set-active",
      { organizationId },
      { cookie: cookies },
    );
    cookies = parseCookies(active) || cookies;
    const project = await post(
      "/api/projects",
      { name: "Sparkle Delta Project", slug: "sparkle-delta" },
      { cookie: cookies },
    );
    expect(project.status).toBe(201);
    ({ id: projectId } = await project.json<{ id: string }>());

    const macos = {
      platform: "macos",
      distribution: "developer-id",
      metadata: { macos: { appName: "Example Desktop" } },
    };
    const build = await completedBuild({
      ...macos,
      artifactFormat: "zip",
      appVersion: "1.4.0",
      buildNumber: "140",
    });
    buildId = build.id;
    ({ id: pkgBuildId } = await completedBuild({
      ...macos,
      artifactFormat: "pkg",
      appVersion: "1.4.0",
      buildNumber: "140",
    }));
    ({ id: windowsBuildId } = await completedBuild({
      platform: "windows",
      distribution: "direct",
      artifactFormat: "exe",
      appVersion: "1.4.0",
      metadata: { windows: { appName: "Example Desktop", architectures: ["x64"] } },
    }));

    const release = await post(
      `/api/projects/${projectId}/desktop-releases`,
      { buildId, channel: "latest", sha512: build.sha512, sparkleEdSignature: edSignature },
      { cookie: cookies },
    );
    expect(release.status).toBe(201);
    ({ id: releaseId } = await release.json<{ id: string }>());
  });

  it("refuses deltas to installer packages, other platforms and the same version", async () => {
    const reserve = async (id: string, deltaFrom: string) =>
      post(
        `/api/builds/${id}/sparkle-deltas`,
        { ...deltaBody(deltaFrom, "patch"), edSignature: deltaSignature },
        { cookie: cookies },
      );
    await expect(reserve(pkgBuildId, "130").then((response) => response.status)).resolves.toBe(400);
    await expect(reserve(windowsBuildId, "130").then((response) => response.status)).resolves.toBe(
      400,
    );
    await expect(reserve(buildId, "140").then((response) => response.status)).resolves.toBe(400);
    const unsigned = await post(
      `/api/builds/${buildId}/sparkle-deltas`,
      deltaBody("130", "patch"),
      { cookie: cookies },
    );
    expect(unsigned.status).toBe(400);
  });

  it("reserves and completes a delta, which the appcast then lists", async () => {
    const body = deltaBody("130", "patch from 130");
    const reserved = await post(
      `/api/builds/${buildId}/sparkle-deltas`,
      {
        ...body,
        edSignature: deltaSignature,
        sparkleExecutableSize: 2_048_000,
        sparkleLocales: "de,fr",
      },
      { cookie: cookies },
    );
    expect(reserved.status).toBe(201);
    const reservation = await reserved.json<{
      uploadUrl: string;
      uploadHeaders: Record<string, string>;
    }>();
    expect(new URL(reservation.uploadUrl).pathname).toContain(`${buildId}.delta-`);
    expect(reservation.uploadHeaders["x-amz-checksum-sha256"]).toBe(
      Buffer.from(body.sha256, "hex").toString("base64"),
    );

    const mismatch = await post(
      `/api/builds/${buildId}/sparkle-deltas/complete`,
      { ...body, byteSize: body.byteSize + 1 },
      { cookie: cookies },
    );
    expect(mismatch.status).toBe(400);

    const completed = await post(`/api/builds/${buildId}/sparkle-deltas/complete`, body, {
      cookie: cookies,
    });
    expect(completed.status).toBe(200);
    const delta = await completed.json<{ id: string }>();
    expect(delta).toMatchObject({
      buildId,
      deltaFrom: "130",
      byteSize: body.byteSize,
      sha256: body.sha256,
      sparkleExecutableSize: 2_048_000,
      sparkleLocales: "de,fr",
    });

    const again = await post(`/api/builds/${buildId}/sparkle-deltas/complete`, body, {
      cookie: cookies,
    });
    expect(again.status).toBe(404);

    const list = await get(`/api/builds/${buildId}/sparkle-deltas`, { cookie: cookies });
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({ items: [{ id: delta.id }] });

    const feed = await get(`/feeds/${projectId}/macos/appcast.xml`);
    const xml = await feed.text();
    const url = `http://localhost/feeds/${projectId}/macos/delta/${releaseId}/${delta.id}/Example-Desktop140-130.delta`;
    expect(xml).toContain(
      `<sparkle:deltas>\n        <enclosure url="${url}" sparkle:deltaFrom="130" length="${String(body.byteSize)}" type="application/octet-stream" sparkle:deltaFromSparkleExecutableSize="2048000" sparkle:deltaFromSparkleLocales="de,fr" sparkle:edSignature="${deltaSignature}"/>\n      </sparkle:deltas>`,
    );
  });

  it("redirects a delta download to its signed R2 URL", async () => {
    const list = await get(`/api/builds/${buildId}/sparkle-deltas`, { cookie: cookies });
    const {
      items: [delta],
    } = await list.json<{ items: { id: string }[] }>();
    const path = `delta/${releaseId}/${delta?.id ?? ""}/Example-Desktop140-130.delta`;
    const download = await get(`/feeds/${projectId}/macos/${path}`);
    expect(download.status).toBe(302);
    const location = new URL(download.headers.get("location") ?? "");
    expect(location.pathname).toContain(`${buildId}.delta-${delta?.id ?? ""}`);
    expect(location.searchParams.get("response-content-disposition")).toBe(
      'attachment; filename="Example-Desktop140-130.delta"',
    );

    // Only under the release that lists it, in this project, on the macOS feed.
    const otherRelease = await get(
      `/feeds/${projectId}/macos/delta/00000000-0000-7000-8000-000000000000/${delta?.id ?? ""}/x.delta`,
    );
    expect(otherRelease.status).toBe(404);
    const otherProject = await get(`/feeds/00000000-0000-7000-8000-000000000000/macos/${path}`);
    expect(otherProject.status).toBe(404);
    const windows = await get(`/feeds/${projectId}/windows/${path}`);
    expect(windows.status).toBe(404);
  });

  it("replaces a delta from the same version, deleting the old object", async () => {
    const list = await get(`/api/builds/${buildId}/sparkle-deltas`, { cookie: cookies });
    const {
      items: [first],
    } = await list.json<{ items: { id: string }[] }>();
    const firstKey = await storedKey(first?.id ?? "");
    await env.BUILD_BUCKET.put(firstKey, "old patch");

    const body = deltaBody("130", "a smaller patch from 130");
    const reserved = await post(
      `/api/builds/${buildId}/sparkle-deltas`,
      { ...body, edSignature: deltaSignature },
      { cookie: cookies },
    );
    expect(reserved.status).toBe(201);
    const completed = await post(`/api/builds/${buildId}/sparkle-deltas/complete`, body, {
      cookie: cookies,
    });
    expect(completed.status).toBe(200);
    const second = await completed.json<{ id: string; sparkleExecutableSize: null }>();
    expect(second.id).not.toBe(first?.id);
    expect(second.sparkleExecutableSize).toBeNull();
    await expect(env.BUILD_BUCKET.head(firstKey)).resolves.toBeNull();

    const after = await get(`/api/builds/${buildId}/sparkle-deltas`, { cookie: cookies });
    await expect(after.json()).resolves.toMatchObject({ items: [{ id: second.id }] });
  });

  it("deletes a build's deltas with the build", async () => {
    const list = await get(`/api/builds/${buildId}/sparkle-deltas`, { cookie: cookies });
    const {
      items: [delta],
    } = await list.json<{ items: { id: string }[] }>();
    const key = await storedKey(delta?.id ?? "");
    await env.BUILD_BUCKET.put(key, "patch");

    const deleted = await del(`/api/builds/${buildId}`, { cookie: cookies });
    expect(deleted.status).toBe(200);
    await expect(env.BUILD_BUCKET.head(key)).resolves.toBeNull();
    await expect(storedKey(delta?.id ?? "")).resolves.toBe("");
  });

  it("records delta uploads in the audit log", async () => {
    const audit = await get("/api/audit-logs?resourceType=build", { cookie: cookies });
    const body = await audit.json<{ items: { action: string }[] }>();
    expect(body.items.map((item) => item.action)).toContain("build.sparkle_delta.upload");
  });
});
