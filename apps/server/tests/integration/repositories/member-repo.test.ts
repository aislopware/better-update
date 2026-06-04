import { env } from "cloudflare:test";
import { Effect } from "effect";

import { MemberRepo, MemberRepoLive } from "../../../src/repositories/member-repo";
import { runWithLayerAndEnv } from "../../helpers/runtime";

// ── Helpers ───────────────────────────────────────────────────────

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, MemberRepo>) =>
  runWithLayerAndEnv(effect, MemberRepoLive, env);

const withRepo = <Ret, Err>(use: (repo: MemberRepo["Type"]) => Effect.Effect<Ret, Err>) =>
  run(
    Effect.gen(function* () {
      const repo = yield* MemberRepo;
      return yield* use(repo);
    }),
  );

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

const insertMember = (params: {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly role: string;
}) =>
  env.DB.prepare(
    `INSERT INTO "member" ("id", "organization_id", "user_id", "role", "created_at") VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(params.id, params.organizationId, params.userId, params.role, "2026-01-01T00:00:00Z")
    .run();

// ── Fixtures: two orgs, each with an owner; org A also has a plain member ─

const ORG_A = "org-member-a";
const ORG_B = "org-member-b";

beforeAll(async () => {
  await insertOrg(ORG_A);
  await insertOrg(ORG_B);
  await insertUser("u-a-owner");
  await insertUser("u-a-member");
  await insertUser("u-b-owner");
  await insertMember({
    id: "m-a-owner",
    organizationId: ORG_A,
    userId: "u-a-owner",
    role: "owner",
  });
  await insertMember({
    id: "m-a-member",
    organizationId: ORG_A,
    userId: "u-a-member",
    role: "member",
  });
  await insertMember({
    id: "m-b-owner",
    organizationId: ORG_B,
    userId: "u-b-owner",
    role: "owner",
  });
});

// ── Tests: org-scoping is the safety property the remove-member guard relies on ─

describe("MemberRepo — D1 integration", () => {
  it("countOwners counts only THIS org's owners (org-scoped)", async () => {
    expect(await withRepo((repo) => repo.countOwners({ organizationId: ORG_A }))).toBe(1);
    expect(await withRepo((repo) => repo.countOwners({ organizationId: ORG_B }))).toBe(1);
    expect(await withRepo((repo) => repo.countOwners({ organizationId: "org-nonexistent" }))).toBe(
      0,
    );
  });

  it("findInOrg returns the member in its own org but NULL across orgs", async () => {
    const inOwnOrg = await withRepo((repo) =>
      repo.findInOrg({ id: "m-a-owner", organizationId: ORG_A }),
    );
    expect(inOwnOrg?.role).toBe("owner");

    // The same member id, queried under a DIFFERENT org, must not leak.
    const crossOrg = await withRepo((repo) =>
      repo.findInOrg({ id: "m-a-owner", organizationId: ORG_B }),
    );
    expect(crossOrg).toBeNull();
  });

  it("remove is org-scoped — a mismatched org deletes nothing, the right org deletes the row", async () => {
    // Wrong org → no-op, row survives.
    const wrongOrg = await withRepo((repo) =>
      repo.remove({ id: "m-a-member", organizationId: ORG_B }),
    );
    expect(wrongOrg).toBe(false);
    const survived = await withRepo((repo) =>
      repo.findInOrg({ id: "m-a-member", organizationId: ORG_A }),
    );
    expect(survived).not.toBeNull();

    // Correct org → removed.
    const removed = await withRepo((repo) =>
      repo.remove({ id: "m-a-member", organizationId: ORG_A }),
    );
    expect(removed).toBe(true);
    const gone = await withRepo((repo) =>
      repo.findInOrg({ id: "m-a-member", organizationId: ORG_A }),
    );
    expect(gone).toBeNull();
  });
});
