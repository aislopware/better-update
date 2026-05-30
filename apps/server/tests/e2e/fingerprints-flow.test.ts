import { setupE2EWorker } from "../helpers/e2e-worker-pool";
import { seedD1 } from "../helpers/seed-d1";

const { get, parseCookies, post } = setupE2EWorker();

const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;

const FP = "fp-aaaa1111bbbb2222";
const OTHERFP = "fp-zzzz9999";

describe("Fingerprint detail endpoint", () => {
  let cookies: string;
  let organizationId: string;
  let secondaryOrgId: string;
  let projectId: string;

  it("rejects unauthenticated requests", async () => {
    const response = await get(`/api/projects/missing-project/fingerprints/${FP}`);
    expect(response.status).toBe(401);
  });

  it("registers a new user", async () => {
    const response = await post("/api/auth/sign-up/email", {
      name: "Fingerprints E2E User",
      email: "fingerprints-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(response.status).toBe(200);
    cookies = parseCookies(response);
    expect(cookies).toBeTruthy();
  });

  it("creates and activates the primary organization", async () => {
    const createOrgResponse = await post(
      "/api/auth/organization/create",
      { name: "Fingerprints Org", slug: "fingerprints-org" },
      { cookie: cookies },
    );
    expect(createOrgResponse.status).toBe(200);
    organizationId = (await createOrgResponse.json()).id;
    cookies = parseCookies(createOrgResponse) || cookies;

    const setActiveResponse = await post(
      "/api/auth/organization/set-active",
      { organizationId },
      { cookie: cookies },
    );
    expect(setActiveResponse.status).toBe(200);
    cookies = parseCookies(setActiveResponse) || cookies;
  });

  it("creates a project and seeds fingerprint-tagged builds and updates", async () => {
    const createProjectResponse = await post(
      "/api/projects",
      { name: "Fingerprints Project", slug: "fingerprints-e2e" },
      { cookie: cookies },
    );
    expect(createProjectResponse.status).toBe(201);
    projectId = (await createProjectResponse.json()).id;

    await seedD1(`
-- Project create auto-provisions production/staging/preview channels + branches;
-- clear them so the fixed-id branch seeded below is the only one the updates JOIN sees.
DELETE FROM "channels" WHERE "project_id" = ${sqlString(projectId)};
DELETE FROM "branches" WHERE "project_id" = ${sqlString(projectId)};

INSERT INTO "branches" ("id", "project_id", "name", "created_at")
VALUES ('fp-branch-main', ${sqlString(projectId)}, 'main', '2024-01-01T00:00:00Z');

-- builds: two share FP, one has OTHERFP, one has NULL fingerprint_hash.
-- created_at: fp-build-new is newer than fp-build-old (handler orders created_at DESC).
INSERT INTO "builds" ("id", "project_id", "platform", "profile", "distribution", "runtime_version", "app_version", "build_number", "bundle_id", "message", "metadata_json", "fingerprint_hash", "created_at")
VALUES
  ('fp-build-old', ${sqlString(projectId)}, 'ios', 'production', 'development', '1.0.0', '1.0.0', '1', 'com.example.fp', 'Old matching build', '{}', ${sqlString(FP)}, '2024-02-01T00:00:00Z'),
  ('fp-build-new', ${sqlString(projectId)}, 'ios', 'production', 'development', '1.0.0', '1.0.0', '2', 'com.example.fp', 'New matching build', '{}', ${sqlString(FP)}, '2024-02-02T00:00:00Z'),
  ('fp-build-other', ${sqlString(projectId)}, 'android', 'production', 'play-store', '1.0.0', '1.0.0', '3', 'com.example.fp', 'Other fingerprint build', '{}', ${sqlString(OTHERFP)}, '2024-02-03T00:00:00Z'),
  ('fp-build-nullfp', ${sqlString(projectId)}, 'ios', 'production', 'development', '1.0.0', '1.0.0', '4', 'com.example.fp', 'No fingerprint build', '{}', NULL, '2024-02-04T00:00:00Z');

-- Give the OLDER matching build an artifact row so both artifact:null (LEFT JOIN miss)
-- and artifact:{...} are exercised in the same response.
INSERT INTO "build_artifacts" ("build_id", "r2_key", "format", "content_type", "byte_size", "sha256", "created_at")
VALUES ('fp-build-old', 'builds/fp-build-old/app.ipa', 'ipa', 'application/octet-stream', 1024, 'abc123sha', '2024-02-01T00:00:00Z');

-- updates: one matches FP, one OTHERFP, one NULL fp. branch_id references the seeded branch.
INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "rollout_percentage", "is_rollback", "fingerprint_hash", "created_at")
VALUES
  ('fp-update-match', 'fp-branch-main', '1.0.0', 'ios', 'Matching update', '{}', 'grp-fp-match', 100, 0, ${sqlString(FP)}, '2024-03-01T00:00:00Z'),
  ('fp-update-other', 'fp-branch-main', '1.0.0', 'android', 'Other fingerprint update', '{}', 'grp-fp-other', 100, 0, ${sqlString(OTHERFP)}, '2024-03-02T00:00:00Z'),
  ('fp-update-nullfp', 'fp-branch-main', '1.0.0', 'ios', 'No fingerprint update', '{}', 'grp-fp-null', 100, 0, NULL, '2024-03-03T00:00:00Z');
`);
  });

  it("returns matching builds and updates for a fingerprint, ordered and filtered", async () => {
    const response = await get(`/api/projects/${projectId}/fingerprints/${FP}`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.hash).toBe(FP);
    expect(body.projectId).toBe(projectId);

    // Only the two FP-tagged builds; OTHERFP and NULL-fp builds are excluded.
    expect(body.builds).toHaveLength(2);
    const buildIds = body.builds.map((build: { id: string }) => build.id);
    expect(buildIds).toEqual(["fp-build-new", "fp-build-old"]);
    expect(buildIds).not.toContain("fp-build-other");
    expect(buildIds).not.toContain("fp-build-nullfp");

    for (const build of body.builds) {
      expect(build.fingerprintHash).toBe(FP);
    }

    // Newest build carries no artifact row (LEFT JOIN miss -> null).
    const newBuild = body.builds.find((build: { id: string }) => build.id === "fp-build-new");
    expect(newBuild.artifact).toBeNull();

    // Older build carries the seeded artifact row.
    const oldBuild = body.builds.find((build: { id: string }) => build.id === "fp-build-old");
    expect(oldBuild.artifact).toMatchObject({
      r2Key: "builds/fp-build-old/app.ipa",
      format: "ipa",
      byteSize: 1024,
      sha256: "abc123sha",
    });

    // Only the FP-tagged update; OTHERFP and NULL-fp updates are excluded.
    expect(body.updates).toHaveLength(1);
    expect(body.updates[0].id).toBe("fp-update-match");
    expect(body.updates[0].fingerprintHash).toBe(FP);
    expect(body.updates[0].message).toBe("Matching update");
    const updateIds = body.updates.map((update: { id: string }) => update.id);
    expect(updateIds).not.toContain("fp-update-other");
    expect(updateIds).not.toContain("fp-update-nullfp");
  });

  it("returns empty builds and updates for an unknown but valid hash", async () => {
    const response = await get(`/api/projects/${projectId}/fingerprints/fp-nonexistent-hash`, {
      cookie: cookies,
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.hash).toBe("fp-nonexistent-hash");
    expect(body.projectId).toBe(projectId);
    expect(body.builds).toEqual([]);
    expect(body.updates).toEqual([]);
  });

  it("returns 404 when the active organization does not own the project", async () => {
    const createOrgResponse = await post(
      "/api/auth/organization/create",
      { name: "Other Fingerprints Org", slug: "other-fingerprints-org" },
      { cookie: cookies },
    );
    expect(createOrgResponse.status).toBe(200);
    secondaryOrgId = (await createOrgResponse.json()).id;
    cookies = parseCookies(createOrgResponse) || cookies;

    const setActiveResponse = await post(
      "/api/auth/organization/set-active",
      { organizationId: secondaryOrgId },
      { cookie: cookies },
    );
    expect(setActiveResponse.status).toBe(200);
    cookies = parseCookies(setActiveResponse) || cookies;

    const response = await get(`/api/projects/${projectId}/fingerprints/${FP}`, {
      cookie: cookies,
    });
    expect(response.status).toBe(404);
  });

  it("returns 404 for a non-existent project id", async () => {
    const setActiveResponse = await post(
      "/api/auth/organization/set-active",
      { organizationId },
      { cookie: cookies },
    );
    expect(setActiveResponse.status).toBe(200);
    cookies = parseCookies(setActiveResponse) || cookies;

    const response = await get(`/api/projects/fp-does-not-exist/fingerprints/${FP}`, {
      cookie: cookies,
    });
    expect(response.status).toBe(404);
  });
});
