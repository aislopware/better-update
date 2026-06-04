import { env } from "cloudflare:test";
import { Cause, Effect, Exit, Option } from "effect";

import { GroupRepo, GroupRepoLive } from "../../../src/repositories/group-repo";
import { runWithLayerAndEnv } from "../../helpers/runtime";

// ── Helpers ───────────────────────────────────────────────────────

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, GroupRepo>) =>
  runWithLayerAndEnv(effect, GroupRepoLive, env);

const insertOrg = (id: string) =>
  env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(id, `Org ${id}`, `${id}-slug`, "2026-01-01T00:00:00Z")
    .run();

const insertUser = (id: string) =>
  env.DB.prepare(
    `INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at") VALUES (?, ?, ?, 1, ?, ?)`,
  )
    .bind(id, `User ${id}`, `${id}@example.com`, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z")
    .run();

const insertMember = (id: string, organizationId: string) =>
  env.DB.prepare(
    `INSERT INTO "member" ("id", "organization_id", "user_id", "role", "created_at") VALUES (?, ?, ?, 'member', ?)`,
  )
    .bind(id, organizationId, `user-${id}`, "2026-01-01T00:00:00Z")
    .run();

const insertAttachment = (params: {
  readonly id: string;
  readonly organizationId: string;
  readonly groupId: string;
}) =>
  env.DB.prepare(
    `INSERT INTO "policy_attachment" ("id", "organization_id", "policy_id", "principal_type", "principal_id", "created_at") VALUES (?, ?, ?, 'group', ?, ?)`,
  )
    .bind(
      params.id,
      params.organizationId,
      "managed:viewer",
      params.groupId,
      "2026-01-01T00:00:00Z",
    )
    .run();

// ── Setup ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await insertOrg("org-group-1");
  await insertOrg("org-group-2");
  // insertMember binds `user-${memberId}` as the user_id FK, so seed each user at
  // that exact id (e.g. member "member-alice" → user "user-member-alice").
  for (const name of ["alice", "bob", "carol"]) {
    await insertUser(`user-member-${name}`);
    await insertMember(`member-${name}`, "org-group-1");
  }
});

// ── Tests ─────────────────────────────────────────────────────────

describe("GroupRepo — D1 integration", () => {
  it("creates, reads, lists, updates and deletes a group (CRUD round-trip)", async () => {
    const created = await run(
      Effect.gen(function* () {
        const repo = yield* GroupRepo;
        return yield* repo.create({
          organizationId: "org-group-1",
          name: "deployers",
          description: "people who deploy",
        });
      }),
    );
    expect(created.id).toBeTruthy();
    expect(created.name).toBe("deployers");
    expect(created.description).toBe("people who deploy");
    expect(created.updatedAt).toBeNull();

    const fetched = await run(
      Effect.gen(function* () {
        const repo = yield* GroupRepo;
        return yield* repo.findById({ id: created.id, organizationId: "org-group-1" });
      }),
    );
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe("deployers");

    // tenant scope: invisible from the other org.
    const crossOrg = await run(
      Effect.gen(function* () {
        const repo = yield* GroupRepo;
        return yield* repo.findById({ id: created.id, organizationId: "org-group-2" });
      }),
    );
    expect(crossOrg).toBeNull();

    const listed = await run(
      Effect.gen(function* () {
        const repo = yield* GroupRepo;
        return yield* repo.list({ organizationId: "org-group-1" });
      }),
    );
    expect(listed.map((group) => group.name)).toContain("deployers");

    const updated = await run(
      Effect.gen(function* () {
        const repo = yield* GroupRepo;
        return yield* repo.update({
          id: created.id,
          organizationId: "org-group-1",
          name: "deployers-renamed",
        });
      }),
    );
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("deployers-renamed");
    expect(updated!.updatedAt).not.toBeNull();

    const deleted = await run(
      Effect.gen(function* () {
        const repo = yield* GroupRepo;
        return yield* repo.delete({ id: created.id, organizationId: "org-group-1" });
      }),
    );
    expect(deleted).toBe(true);

    const deletedAgain = await run(
      Effect.gen(function* () {
        const repo = yield* GroupRepo;
        return yield* repo.delete({ id: created.id, organizationId: "org-group-1" });
      }),
    );
    expect(deletedAgain).toBe(false);
  });

  it("a duplicate name fails a TYPED Conflict (409), not an untyped 500 defect", async () => {
    const create = () =>
      run(
        Effect.gen(function* () {
          const repo = yield* GroupRepo;
          return yield* repo.create({
            organizationId: "org-group-1",
            name: "dup-group-name",
            description: null,
          });
        }).pipe(Effect.exit),
      );

    const first = await create();
    expect(Exit.isSuccess(first)).toBe(true);

    const second = await create();
    expect(Exit.isFailure(second)).toBe(true);
    const failure = Exit.isFailure(second)
      ? Option.getOrUndefined(Cause.failureOption(second.cause))
      : undefined;
    expect(failure?._tag).toBe("Conflict");
  });

  it("adds members idempotently, lists them, finds group ids per member, and removes them", async () => {
    const group = await run(
      Effect.gen(function* () {
        const repo = yield* GroupRepo;
        return yield* repo.create({
          organizationId: "org-group-1",
          name: "membership-grp",
          description: null,
        });
      }),
    );

    await run(
      Effect.gen(function* () {
        const repo = yield* GroupRepo;
        yield* repo.addMember({ groupId: group.id, memberId: "member-alice" });
        yield* repo.addMember({ groupId: group.id, memberId: "member-bob" });
        // duplicate add is a no-op (ON CONFLICT DO NOTHING).
        yield* repo.addMember({ groupId: group.id, memberId: "member-alice" });
      }),
    );

    const members = await run(
      Effect.gen(function* () {
        const repo = yield* GroupRepo;
        return yield* repo.listMembers({ groupId: group.id });
      }),
    );
    expect(members.map((member) => member.memberId).sort()).toEqual(["member-alice", "member-bob"]);
    expect(members).toHaveLength(2);

    const aliceGroups = await run(
      Effect.gen(function* () {
        const repo = yield* GroupRepo;
        return yield* repo.findGroupIdsForMember({ memberId: "member-alice" });
      }),
    );
    expect(aliceGroups).toContain(group.id);

    await run(
      Effect.gen(function* () {
        const repo = yield* GroupRepo;
        yield* repo.removeMember({ groupId: group.id, memberId: "member-alice" });
      }),
    );

    const afterRemove = await run(
      Effect.gen(function* () {
        const repo = yield* GroupRepo;
        return yield* repo.listMembers({ groupId: group.id });
      }),
    );
    expect(afterRemove.map((member) => member.memberId)).toEqual(["member-bob"]);

    const aliceGroupsAfter = await run(
      Effect.gen(function* () {
        const repo = yield* GroupRepo;
        return yield* repo.findGroupIdsForMember({ memberId: "member-alice" });
      }),
    );
    expect(aliceGroupsAfter).not.toContain(group.id);
  });

  it("findGroupIdsForMember returns every group a member is in", async () => {
    const [groupOne, groupTwo] = await run(
      Effect.gen(function* () {
        const repo = yield* GroupRepo;
        const one = yield* repo.create({
          organizationId: "org-group-1",
          name: "multi-grp-1",
          description: null,
        });
        const two = yield* repo.create({
          organizationId: "org-group-1",
          name: "multi-grp-2",
          description: null,
        });
        yield* repo.addMember({ groupId: one.id, memberId: "member-carol" });
        yield* repo.addMember({ groupId: two.id, memberId: "member-carol" });
        return [one, two] as const;
      }),
    );

    const groups = await run(
      Effect.gen(function* () {
        const repo = yield* GroupRepo;
        return yield* repo.findGroupIdsForMember({ memberId: "member-carol" });
      }),
    );
    expect(groups.sort()).toEqual([groupOne.id, groupTwo.id].sort());
  });

  it("delete sweeps the group's attachments and cascades memberships", async () => {
    const group = await run(
      Effect.gen(function* () {
        const repo = yield* GroupRepo;
        return yield* repo.create({
          organizationId: "org-group-1",
          name: "to-delete",
          description: null,
        });
      }),
    );

    await run(
      Effect.gen(function* () {
        const repo = yield* GroupRepo;
        yield* repo.addMember({ groupId: group.id, memberId: "member-bob" });
      }),
    );
    await insertAttachment({ id: "grp-att-1", organizationId: "org-group-1", groupId: group.id });

    const attBefore = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM "policy_attachment" WHERE "principal_type" = 'group' AND "principal_id" = ?`,
    )
      .bind(group.id)
      .first<{ n: number }>();
    const memBefore = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM "iam_group_membership" WHERE "group_id" = ?`,
    )
      .bind(group.id)
      .first<{ n: number }>();
    expect(attBefore!.n).toBe(1);
    expect(memBefore!.n).toBe(1);

    await run(
      Effect.gen(function* () {
        const repo = yield* GroupRepo;
        yield* repo.delete({ id: group.id, organizationId: "org-group-1" });
      }),
    );

    const attAfter = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM "policy_attachment" WHERE "principal_type" = 'group' AND "principal_id" = ?`,
    )
      .bind(group.id)
      .first<{ n: number }>();
    const memAfter = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM "iam_group_membership" WHERE "group_id" = ?`,
    )
      .bind(group.id)
      .first<{ n: number }>();
    // attachment swept app-side; membership cascaded via FK on group delete.
    expect(attAfter!.n).toBe(0);
    expect(memAfter!.n).toBe(0);
  });
});
