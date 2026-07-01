import { env } from "cloudflare:test";
import { Effect } from "effect";

import {
  PolicyAttachmentRepo,
  PolicyAttachmentRepoLive,
} from "../../../src/repositories/policy-attachment-repo";
import { runWithLayerAndEnv } from "../../helpers/runtime";

// ── Helpers ───────────────────────────────────────────────────────

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, PolicyAttachmentRepo>) =>
  runWithLayerAndEnv(effect, PolicyAttachmentRepoLive, env);

const insertOrg = (id: string) =>
  env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(id, `Org ${id}`, `${id}-slug`, "2026-01-01T00:00:00Z")
    .run();

// ── Setup ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await insertOrg("org-att-1");
  await insertOrg("org-att-2");
});

// ── Tests ─────────────────────────────────────────────────────────

describe("PolicyAttachmentRepo — D1 integration", () => {
  it("attaches a policy to a principal idempotently (one row per policy+principal)", async () => {
    await run(
      Effect.gen(function* () {
        const repo = yield* PolicyAttachmentRepo;
        yield* repo.attach({
          organizationId: "org-att-1",
          policyId: "policy-idem",
          principal: { type: "member", id: "member-idem" },
        });
        // second attach is a no-op (ON CONFLICT DO NOTHING).
        yield* repo.attach({
          organizationId: "org-att-1",
          policyId: "policy-idem",
          principal: { type: "member", id: "member-idem" },
        });
      }),
    );

    const rows = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM "policy_attachment" WHERE "policy_id" = ? AND "principal_type" = 'member' AND "principal_id" = ?`,
    )
      .bind("policy-idem", "member-idem")
      .first<{ n: number }>();
    expect(rows!.n).toBe(1);
  });

  it("lists attachments for a single principal, tenant-scoped", async () => {
    await run(
      Effect.gen(function* () {
        const repo = yield* PolicyAttachmentRepo;
        yield* repo.attach({
          organizationId: "org-att-1",
          policyId: "managed:viewer",
          principal: { type: "member", id: "member-list" },
        });
        yield* repo.attach({
          organizationId: "org-att-1",
          policyId: "policy-real",
          principal: { type: "member", id: "member-list" },
        });
      }),
    );

    const listed = await run(
      Effect.gen(function* () {
        const repo = yield* PolicyAttachmentRepo;
        return yield* repo.listForPrincipal({
          organizationId: "org-att-1",
          principal: { type: "member", id: "member-list" },
        });
      }),
    );
    expect(listed.map((att) => att.policyId).sort()).toEqual(["managed:viewer", "policy-real"]);
    expect(listed.every((att) => att.organizationId === "org-att-1")).toBe(true);

    // a different org sees nothing for the same principal id.
    const otherOrg = await run(
      Effect.gen(function* () {
        const repo = yield* PolicyAttachmentRepo;
        return yield* repo.listForPrincipal({
          organizationId: "org-att-2",
          principal: { type: "member", id: "member-list" },
        });
      }),
    );
    expect(otherOrg).toHaveLength(0);
  });

  it("findForPrincipals returns the union across member + group principals", async () => {
    await run(
      Effect.gen(function* () {
        const repo = yield* PolicyAttachmentRepo;
        yield* repo.attach({
          organizationId: "org-att-1",
          policyId: "policy-direct",
          principal: { type: "member", id: "member-union" },
        });
        yield* repo.attach({
          organizationId: "org-att-1",
          policyId: "policy-via-group",
          principal: { type: "group", id: "group-union" },
        });
        // noise: same principal ids in the OTHER org must not leak.
        yield* repo.attach({
          organizationId: "org-att-2",
          policyId: "policy-noise",
          principal: { type: "member", id: "member-union" },
        });
      }),
    );

    const found = await run(
      Effect.gen(function* () {
        const repo = yield* PolicyAttachmentRepo;
        return yield* repo.findForPrincipals({
          organizationId: "org-att-1",
          principals: [
            { type: "member", id: "member-union" },
            { type: "group", id: "group-union" },
          ],
        });
      }),
    );
    expect(found.map((att) => att.policyId).sort()).toEqual(["policy-direct", "policy-via-group"]);
  });

  it("findForPrincipals returns [] for no principals (no query)", async () => {
    const found = await run(
      Effect.gen(function* () {
        const repo = yield* PolicyAttachmentRepo;
        return yield* repo.findForPrincipals({
          organizationId: "org-att-1",
          principals: [],
        });
      }),
    );
    expect(found).toEqual([]);
  });

  it("detach removes the attachment (and is a no-op when absent)", async () => {
    await run(
      Effect.gen(function* () {
        const repo = yield* PolicyAttachmentRepo;
        yield* repo.attach({
          organizationId: "org-att-1",
          policyId: "policy-detach",
          principal: { type: "robot", id: "robot-detach" },
        });
      }),
    );

    const before = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM "policy_attachment" WHERE "policy_id" = ? AND "principal_id" = ?`,
    )
      .bind("policy-detach", "robot-detach")
      .first<{ n: number }>();
    expect(before!.n).toBe(1);

    await run(
      Effect.gen(function* () {
        const repo = yield* PolicyAttachmentRepo;
        yield* repo.detach({
          organizationId: "org-att-1",
          policyId: "policy-detach",
          principal: { type: "robot", id: "robot-detach" },
        });
        // detaching again is a harmless no-op.
        yield* repo.detach({
          organizationId: "org-att-1",
          policyId: "policy-detach",
          principal: { type: "robot", id: "robot-detach" },
        });
      }),
    );

    const after = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM "policy_attachment" WHERE "policy_id" = ? AND "principal_id" = ?`,
    )
      .bind("policy-detach", "robot-detach")
      .first<{ n: number }>();
    expect(after!.n).toBe(0);
  });
});
