import { env } from "cloudflare:test";
import { Effect } from "effect";

import {
  ProjectCredentialBindingRepo,
  ProjectCredentialBindingRepoLive,
} from "../../../src/repositories/project-credential-bindings";
import { runWithLayerAndEnv } from "../../helpers/runtime";

// ── Setup ─────────────────────────────────────────────────────────

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, ProjectCredentialBindingRepo>) =>
  runWithLayerAndEnv(effect, ProjectCredentialBindingRepoLive, env);

const withRepo = <Ret, Err>(
  body: (
    repo: typeof ProjectCredentialBindingRepo.Service,
  ) => Effect.Effect<Ret, Err, ProjectCredentialBindingRepo>,
) =>
  run(
    Effect.gen(function* () {
      const repo = yield* ProjectCredentialBindingRepo;
      return yield* body(repo);
    }),
  );

beforeAll(async () => {
  await env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at")
     VALUES ('org-bind-1', 'Bind Org', 'bind-org', '2026-01-01T00:00:00Z')`,
  ).run();
  await env.DB.prepare(
    `INSERT INTO "projects" ("id", "organization_id", "name", "slug", "created_at")
     VALUES ('proj-bind-a', 'org-bind-1', 'Bind A', 'bind-a', '2026-01-01T00:00:00Z'),
            ('proj-bind-b', 'org-bind-1', 'Bind B', 'bind-b', '2026-01-01T00:00:00Z')`,
  ).run();
});

// ── Tests ─────────────────────────────────────────────────────────

describe("ProjectCredentialBindingRepo", () => {
  it("bind → boundProjectIds → listByProject roundtrip; bind is idempotent", async () => {
    const bind = (id: string, projectId: string) =>
      withRepo((repo) =>
        repo.bind({
          id,
          organizationId: "org-bind-1",
          projectId,
          resourceType: "appleTeam",
          resourceId: "team-1",
          now: "2026-01-01T00:00:00Z",
        }),
      );

    expect(await bind("bind-1", "proj-bind-a")).toBe(true);
    expect(await bind("bind-2", "proj-bind-b")).toBe(true);
    // Re-binding the same (project, type, id) is a no-op reported as
    // not-inserted (callers skip the audit entry), not a constraint error.
    expect(await bind("bind-3", "proj-bind-a")).toBe(false);

    const bound = await withRepo((repo) =>
      repo.boundProjectIds({
        organizationId: "org-bind-1",
        resourceType: "appleTeam",
        resourceId: "team-1",
      }),
    );
    expect([...bound].sort()).toStrictEqual(["proj-bind-a", "proj-bind-b"]);

    const listed = await withRepo((repo) =>
      repo.listByProject({ organizationId: "org-bind-1", projectId: "proj-bind-a" }),
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      projectId: "proj-bind-a",
      resourceType: "appleTeam",
      resourceId: "team-1",
    });
  });

  it("boundProjectIdsByResource groups a whole type in one query", async () => {
    await withRepo((repo) =>
      repo.bind({
        id: "bind-ks",
        organizationId: "org-bind-1",
        projectId: "proj-bind-a",
        resourceType: "androidUploadKeystore",
        resourceId: "ks-1",
        now: "2026-01-01T00:00:00Z",
      }),
    );

    const byResource = await withRepo((repo) =>
      repo.boundProjectIdsByResource({
        organizationId: "org-bind-1",
        resourceType: "androidUploadKeystore",
      }),
    );
    expect(byResource["ks-1"]).toStrictEqual(["proj-bind-a"]);
    // Other types never bleed in.
    expect(byResource["team-1"]).toBeUndefined();
  });

  it("unbind removes exactly one binding and reports a missing one as false", async () => {
    const removed = await withRepo((repo) =>
      repo.unbind({
        organizationId: "org-bind-1",
        projectId: "proj-bind-b",
        resourceType: "appleTeam",
        resourceId: "team-1",
      }),
    );
    expect(removed).toBe(true);

    const again = await withRepo((repo) =>
      repo.unbind({
        organizationId: "org-bind-1",
        projectId: "proj-bind-b",
        resourceType: "appleTeam",
        resourceId: "team-1",
      }),
    );
    expect(again).toBe(false);

    const bound = await withRepo((repo) =>
      repo.boundProjectIds({
        organizationId: "org-bind-1",
        resourceType: "appleTeam",
        resourceId: "team-1",
      }),
    );
    expect(bound).toStrictEqual(["proj-bind-a"]);
  });

  it("removeAllForResource drops every binding of one credential (deletion path)", async () => {
    await withRepo((repo) =>
      repo.removeAllForResource({
        organizationId: "org-bind-1",
        resourceType: "appleTeam",
        resourceId: "team-1",
      }),
    );
    const bound = await withRepo((repo) =>
      repo.boundProjectIds({
        organizationId: "org-bind-1",
        resourceType: "appleTeam",
        resourceId: "team-1",
      }),
    );
    expect(bound).toStrictEqual([]);
  });

  it("org-wide binding expands to every project — including one created later", async () => {
    const inserted = await withRepo((repo) =>
      repo.bindAllProjects({
        id: "org-bind-all-1",
        organizationId: "org-bind-1",
        resourceType: "ascApiKey",
        resourceId: "key-all",
        now: "2026-01-02T00:00:00Z",
      }),
    );
    expect(inserted).toBe(true);
    // Idempotent re-bind is reported as not-inserted (callers skip the audit).
    const again = await withRepo((repo) =>
      repo.bindAllProjects({
        id: "org-bind-all-2",
        organizationId: "org-bind-1",
        resourceType: "ascApiKey",
        resourceId: "key-all",
        now: "2026-01-02T00:00:00Z",
      }),
    );
    expect(again).toBe(false);

    const bound = await withRepo((repo) =>
      repo.boundProjectIds({
        organizationId: "org-bind-1",
        resourceType: "ascApiKey",
        resourceId: "key-all",
      }),
    );
    expect([...bound].sort()).toStrictEqual(["proj-bind-a", "proj-bind-b"]);

    // The core promise: a project created AFTER the org-wide bind is covered
    // with zero additional writes.
    await env.DB.prepare(
      `INSERT INTO "projects" ("id", "organization_id", "name", "slug", "created_at")
       VALUES ('proj-bind-late', 'org-bind-1', 'Bind Late', 'bind-late', '2026-01-03T00:00:00Z')`,
    ).run();
    const expanded = await withRepo((repo) =>
      repo.boundProjectIds({
        organizationId: "org-bind-1",
        resourceType: "ascApiKey",
        resourceId: "key-all",
      }),
    );
    expect([...expanded].sort()).toStrictEqual(["proj-bind-a", "proj-bind-b", "proj-bind-late"]);

    const byResource = await withRepo((repo) =>
      repo.boundProjectIdsByResource({
        organizationId: "org-bind-1",
        resourceType: "ascApiKey",
      }),
    );
    expect([...(byResource["key-all"] ?? [])].sort()).toStrictEqual([
      "proj-bind-a",
      "proj-bind-b",
      "proj-bind-late",
    ]);

    const allIds = await withRepo((repo) =>
      repo.allProjectsResourceIds({ organizationId: "org-bind-1", resourceType: "ascApiKey" }),
    );
    expect(allIds).toStrictEqual(["key-all"]);
  });

  it("listByProject surfaces the org-wide entry once, shadowing an explicit row", async () => {
    // Explicit row for the same resource on proj-bind-a: the org-wide entry
    // supersedes it in the listing.
    await withRepo((repo) =>
      repo.bind({
        id: "bind-shadowed",
        organizationId: "org-bind-1",
        projectId: "proj-bind-a",
        resourceType: "ascApiKey",
        resourceId: "key-all",
        now: "2026-01-02T00:00:00Z",
      }),
    );
    const listed = await withRepo((repo) =>
      repo.listByProject({ organizationId: "org-bind-1", projectId: "proj-bind-late" }),
    );
    const entries = listed.filter((item) => item.resourceId === "key-all");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      projectId: "proj-bind-late",
      resourceType: "ascApiKey",
      allProjects: true,
    });

    const listedA = await withRepo((repo) =>
      repo.listByProject({ organizationId: "org-bind-1", projectId: "proj-bind-a" }),
    );
    expect(listedA.filter((item) => item.resourceId === "key-all")).toHaveLength(1);
  });

  it("unbindAllProjects falls back to explicit rows; removeAllForResource clears both", async () => {
    const removed = await withRepo((repo) =>
      repo.unbindAllProjects({
        organizationId: "org-bind-1",
        resourceType: "ascApiKey",
        resourceId: "key-all",
      }),
    );
    expect(removed).toBe(true);
    const again = await withRepo((repo) =>
      repo.unbindAllProjects({
        organizationId: "org-bind-1",
        resourceType: "ascApiKey",
        resourceId: "key-all",
      }),
    );
    expect(again).toBe(false);

    // The explicit proj-bind-a row from the previous test still applies.
    const bound = await withRepo((repo) =>
      repo.boundProjectIds({
        organizationId: "org-bind-1",
        resourceType: "ascApiKey",
        resourceId: "key-all",
      }),
    );
    expect(bound).toStrictEqual(["proj-bind-a"]);

    await withRepo((repo) =>
      repo.bindAllProjects({
        id: "org-bind-all-3",
        organizationId: "org-bind-1",
        resourceType: "ascApiKey",
        resourceId: "key-all",
        now: "2026-01-04T00:00:00Z",
      }),
    );
    await withRepo((repo) =>
      repo.removeAllForResource({
        organizationId: "org-bind-1",
        resourceType: "ascApiKey",
        resourceId: "key-all",
      }),
    );
    const cleared = await withRepo((repo) =>
      repo.boundProjectIds({
        organizationId: "org-bind-1",
        resourceType: "ascApiKey",
        resourceId: "key-all",
      }),
    );
    expect(cleared).toStrictEqual([]);
    expect(
      await withRepo((repo) =>
        repo.findAllProjectsBinding({
          organizationId: "org-bind-1",
          resourceType: "ascApiKey",
          resourceId: "key-all",
        }),
      ),
    ).toBeNull();
  });

  it("project deletion cascades its binding rows (FK ON DELETE CASCADE)", async () => {
    await withRepo((repo) =>
      repo.bind({
        id: "bind-cascade",
        organizationId: "org-bind-1",
        projectId: "proj-bind-b",
        resourceType: "googleServiceAccountKey",
        resourceId: "gsa-1",
        now: "2026-01-01T00:00:00Z",
      }),
    );
    await env.DB.prepare(`DELETE FROM "projects" WHERE "id" = 'proj-bind-b'`).run();
    const bound = await withRepo((repo) =>
      repo.boundProjectIds({
        organizationId: "org-bind-1",
        resourceType: "googleServiceAccountKey",
        resourceId: "gsa-1",
      }),
    );
    expect(bound).toStrictEqual([]);
  });
});
