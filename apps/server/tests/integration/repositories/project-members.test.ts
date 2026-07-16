import { env } from "cloudflare:test";
import { Effect } from "effect";

import {
  ProjectMemberRepo,
  ProjectMemberRepoLive,
} from "../../../src/repositories/project-members";
import { runWithLayerAndEnv } from "../../helpers/runtime";

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, ProjectMemberRepo>) =>
  runWithLayerAndEnv(effect, ProjectMemberRepoLive, env);

const ORG = "pm-org";
const NOW = "2026-07-03T00:00:00.000Z";

beforeAll(async () => {
  await env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(ORG, "PM Org", "pm-org-slug", NOW)
    .run();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO "projects" ("id", "organization_id", "name", "slug", "created_at") VALUES ('pm-proj-1', ?, 'One', 'pm-one', ?)`,
    ).bind(ORG, NOW),
    env.DB.prepare(
      `INSERT INTO "projects" ("id", "organization_id", "name", "slug", "created_at") VALUES ('pm-proj-2', ?, 'Two', 'pm-two', ?)`,
    ).bind(ORG, NOW),
    env.DB.prepare(
      `INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at") VALUES ('pm-user', 'PM User', 'pm-user@example.com', 1, ?, ?)`,
    ).bind(NOW, NOW),
    env.DB.prepare(
      `INSERT INTO "member" ("id", "organization_id", "user_id", "role", "created_at") VALUES ('pm-member', ?, 'pm-user', 'member', ?)`,
    ).bind(ORG, NOW),
    env.DB.prepare(
      `INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at") VALUES ('pm-user-2', 'PM User Two', 'pm-user-2@example.com', 1, ?, ?)`,
    ).bind(NOW, NOW),
    env.DB.prepare(
      `INSERT INTO "member" ("id", "organization_id", "user_id", "role", "created_at") VALUES ('pm-member-2', ?, 'pm-user-2', 'member', ?)`,
    ).bind(ORG, NOW),
  ]);
});

describe("ProjectMemberRepo — D1 integration", () => {
  it("upsert inserts then updates in place (unique per principal per project)", async () => {
    await run(
      Effect.gen(function* () {
        const repo = yield* ProjectMemberRepo;
        yield* repo.upsert({
          id: "pm-row-1",
          organizationId: ORG,
          projectId: "pm-proj-1",
          principalType: "member",
          principalId: "pm-member",
          role: "developer",
          now: NOW,
        });
        // Same principal+project, new role → role update, not a second row.
        yield* repo.upsert({
          id: "pm-row-1b",
          organizationId: ORG,
          projectId: "pm-proj-1",
          principalType: "member",
          principalId: "pm-member",
          role: "maintainer",
          now: NOW,
        });
        yield* repo.upsert({
          id: "pm-row-2",
          organizationId: ORG,
          projectId: "pm-proj-2",
          principalType: "member",
          principalId: "pm-member",
          role: "reporter",
          now: NOW,
        });
      }),
    );

    const roles = await run(
      Effect.gen(function* () {
        const repo = yield* ProjectMemberRepo;
        return yield* repo.rolesForPrincipal({
          organizationId: ORG,
          principalType: "member",
          principalId: "pm-member",
        });
      }),
    );
    expect(roles).toStrictEqual({ "pm-proj-1": "maintainer", "pm-proj-2": "reporter" });
  });

  it("listByProject resolves the member's display identity", async () => {
    const rows = await run(
      Effect.gen(function* () {
        const repo = yield* ProjectMemberRepo;
        return yield* repo.listByProject({ organizationId: ORG, projectId: "pm-proj-1" });
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      principalType: "member",
      principalId: "pm-member",
      role: "maintainer",
      displayName: "PM User",
      email: "pm-user@example.com",
    });
  });

  it("remove reports whether a row matched; removeAllForPrincipal sweeps the org", async () => {
    const removed = await run(
      Effect.gen(function* () {
        const repo = yield* ProjectMemberRepo;
        return yield* repo.remove({
          organizationId: ORG,
          projectId: "pm-proj-1",
          principalType: "member",
          principalId: "pm-member",
        });
      }),
    );
    expect(removed).toBe(true);

    const removedAgain = await run(
      Effect.gen(function* () {
        const repo = yield* ProjectMemberRepo;
        return yield* repo.remove({
          organizationId: ORG,
          projectId: "pm-proj-1",
          principalType: "member",
          principalId: "pm-member",
        });
      }),
    );
    expect(removedAgain).toBe(false);

    await run(
      Effect.gen(function* () {
        const repo = yield* ProjectMemberRepo;
        yield* repo.removeAllForPrincipal({
          organizationId: ORG,
          principalType: "member",
          principalId: "pm-member",
        });
        const roles = yield* repo.rolesForPrincipal({
          organizationId: ORG,
          principalType: "member",
          principalId: "pm-member",
        });
        expect(roles).toStrictEqual({});
      }),
    );
  });
});

describe("org-wide (all projects) membership — D1 integration", () => {
  it("expands to every project, merging max with explicit rows", async () => {
    await run(
      Effect.gen(function* () {
        const repo = yield* ProjectMemberRepo;
        yield* repo.upsert({
          id: "pm2-row-1",
          organizationId: ORG,
          projectId: "pm-proj-1",
          principalType: "member",
          principalId: "pm-member-2",
          role: "maintainer",
          now: NOW,
        });
        yield* repo.upsertAllProjects({
          id: "pm2-org",
          organizationId: ORG,
          principalType: "member",
          principalId: "pm-member-2",
          role: "developer",
          now: NOW,
        });
        const roles = yield* repo.rolesForPrincipal({
          organizationId: ORG,
          principalType: "member",
          principalId: "pm-member-2",
        });
        // proj-1 keeps the HIGHER explicit role; proj-2 gets the org-wide one.
        expect(roles).toStrictEqual({ "pm-proj-1": "maintainer", "pm-proj-2": "developer" });
        const orgWideRole = yield* repo.findAllProjects({
          organizationId: ORG,
          principalType: "member",
          principalId: "pm-member-2",
        });
        expect(orgWideRole).toBe("developer");
      }),
    );
  });

  it("listByProject raises covered explicit rows and synthesizes rows elsewhere", async () => {
    const [projectOne, projectTwo] = await run(
      Effect.gen(function* () {
        const repo = yield* ProjectMemberRepo;
        const one = yield* repo.listByProject({ organizationId: ORG, projectId: "pm-proj-1" });
        const two = yield* repo.listByProject({ organizationId: ORG, projectId: "pm-proj-2" });
        return [one, two] as const;
      }),
    );

    // Explicit maintainer row on proj-1 outranks the org-wide developer role.
    expect(projectOne.find((row) => row.principalId === "pm-member-2")).toMatchObject({
      projectId: "pm-proj-1",
      role: "maintainer",
      allProjects: true,
      displayName: "PM User Two",
    });
    // No explicit row on proj-2 → synthesized from the org-wide grant.
    expect(projectTwo.find((row) => row.principalId === "pm-member-2")).toMatchObject({
      projectId: "pm-proj-2",
      role: "developer",
      allProjects: true,
      displayName: "PM User Two",
      email: "pm-user-2@example.com",
    });
  });

  it("membershipSummariesByOrg embeds project names and the org-wide role", async () => {
    const summaries = await run(
      Effect.gen(function* () {
        const repo = yield* ProjectMemberRepo;
        return yield* repo.membershipSummariesByOrg({ organizationId: ORG });
      }),
    );
    expect(summaries.find((summary) => summary.principalId === "pm-member-2")).toStrictEqual({
      principalId: "pm-member-2",
      allProjectsRole: "developer",
      projects: [{ projectId: "pm-proj-1", projectName: "One", role: "maintainer" }],
    });
  });

  it("upsertAllProjects updates in place; removeAllProjects falls back to explicit rows", async () => {
    await run(
      Effect.gen(function* () {
        const repo = yield* ProjectMemberRepo;
        // Idempotent upsert: same principal, new role → update, not a 2nd row.
        yield* repo.upsertAllProjects({
          id: "pm2-org-b",
          organizationId: ORG,
          principalType: "member",
          principalId: "pm-member-2",
          role: "reporter",
          now: NOW,
        });
        const updated = yield* repo.findAllProjects({
          organizationId: ORG,
          principalType: "member",
          principalId: "pm-member-2",
        });
        expect(updated).toBe("reporter");

        const removed = yield* repo.removeAllProjects({
          organizationId: ORG,
          principalType: "member",
          principalId: "pm-member-2",
        });
        expect(removed).toBe(true);
        const removedAgain = yield* repo.removeAllProjects({
          organizationId: ORG,
          principalType: "member",
          principalId: "pm-member-2",
        });
        expect(removedAgain).toBe(false);

        // Explicit rows survive the org-wide revocation.
        const roles = yield* repo.rolesForPrincipal({
          organizationId: ORG,
          principalType: "member",
          principalId: "pm-member-2",
        });
        expect(roles).toStrictEqual({ "pm-proj-1": "maintainer" });
      }),
    );
  });

  it("removeAllForPrincipal sweeps the org-wide row too", async () => {
    await run(
      Effect.gen(function* () {
        const repo = yield* ProjectMemberRepo;
        yield* repo.upsertAllProjects({
          id: "pm2-org-c",
          organizationId: ORG,
          principalType: "member",
          principalId: "pm-member-2",
          role: "developer",
          now: NOW,
        });
        yield* repo.removeAllForPrincipal({
          organizationId: ORG,
          principalType: "member",
          principalId: "pm-member-2",
        });
        const orgWideRole = yield* repo.findAllProjects({
          organizationId: ORG,
          principalType: "member",
          principalId: "pm-member-2",
        });
        expect(orgWideRole).toBeNull();
        const roles = yield* repo.rolesForPrincipal({
          organizationId: ORG,
          principalType: "member",
          principalId: "pm-member-2",
        });
        expect(roles).toStrictEqual({});
      }),
    );
  });
});
