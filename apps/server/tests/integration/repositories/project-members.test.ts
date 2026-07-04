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
