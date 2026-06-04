import { env } from "cloudflare:test";
import { Cause, Effect, Exit, Option } from "effect";

import { PolicyRepo, PolicyRepoLive } from "../../../src/repositories/policy-repo";
import { runWithLayerAndEnv } from "../../helpers/runtime";

import type { PolicyDocument } from "../../../src/models";

// ── Helpers ───────────────────────────────────────────────────────

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, PolicyRepo>) =>
  runWithLayerAndEnv(effect, PolicyRepoLive, env);

const insertOrg = (id: string) =>
  env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(id, `Org ${id}`, `${id}-slug`, "2026-01-01T00:00:00Z")
    .run();

const insertAttachment = (params: {
  readonly id: string;
  readonly organizationId: string;
  readonly policyId: string;
}) =>
  env.DB.prepare(
    `INSERT INTO "policy_attachment" ("id", "organization_id", "policy_id", "principal_type", "principal_id", "created_at") VALUES (?, ?, ?, 'member', ?, ?)`,
  )
    .bind(
      params.id,
      params.organizationId,
      params.policyId,
      `member-${params.id}`,
      "2026-01-01T00:00:00Z",
    )
    .run();

const docOf = (resource: string): PolicyDocument => ({
  statements: [{ effect: "allow", actions: [`${resource}:*`], resources: [`project/${resource}`] }],
});

// ── Setup ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await insertOrg("org-policy-1");
  await insertOrg("org-policy-2");
});

// ── Tests ─────────────────────────────────────────────────────────

describe("PolicyRepo — D1 integration", () => {
  it("creates, reads back, lists, updates and deletes a policy (CRUD round-trip)", async () => {
    const created = await run(
      Effect.gen(function* () {
        const repo = yield* PolicyRepo;
        return yield* repo.create({
          organizationId: "org-policy-1",
          name: "deploy-A",
          description: "deploy to project A",
          document: docOf("A"),
        });
      }),
    );

    expect(created.id).toBeTruthy();
    expect(created.name).toBe("deploy-A");
    expect(created.description).toBe("deploy to project A");
    expect(created.document).toEqual(docOf("A"));
    expect(created.createdAt).toBeTruthy();
    expect(created.updatedAt).toBeNull();

    // findById round-trips the JSON document.
    const fetched = await run(
      Effect.gen(function* () {
        const repo = yield* PolicyRepo;
        return yield* repo.findById({ id: created.id, organizationId: "org-policy-1" });
      }),
    );
    expect(fetched).not.toBeNull();
    expect(fetched!.document).toEqual(docOf("A"));

    // Tenant-scoped: a different org cannot see it.
    const crossOrg = await run(
      Effect.gen(function* () {
        const repo = yield* PolicyRepo;
        return yield* repo.findById({ id: created.id, organizationId: "org-policy-2" });
      }),
    );
    expect(crossOrg).toBeNull();

    // list returns it (ordered by name).
    const listed = await run(
      Effect.gen(function* () {
        const repo = yield* PolicyRepo;
        return yield* repo.list({ organizationId: "org-policy-1" });
      }),
    );
    expect(listed.map((policy) => policy.name)).toContain("deploy-A");

    // update name + document; updatedAt set.
    const updated = await run(
      Effect.gen(function* () {
        const repo = yield* PolicyRepo;
        return yield* repo.update({
          id: created.id,
          organizationId: "org-policy-1",
          name: "deploy-A-renamed",
          document: docOf("B"),
        });
      }),
    );
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("deploy-A-renamed");
    expect(updated!.document).toEqual(docOf("B"));
    expect(updated!.updatedAt).not.toBeNull();

    // delete removes it; second delete reports not-found.
    const deletedFirst = await run(
      Effect.gen(function* () {
        const repo = yield* PolicyRepo;
        return yield* repo.delete({ id: created.id, organizationId: "org-policy-1" });
      }),
    );
    expect(deletedFirst).toBe(true);

    const deletedSecond = await run(
      Effect.gen(function* () {
        const repo = yield* PolicyRepo;
        return yield* repo.delete({ id: created.id, organizationId: "org-policy-1" });
      }),
    );
    expect(deletedSecond).toBe(false);
  });

  it("update with a clear-description sentinel nulls the column; partial update keeps the document", async () => {
    const created = await run(
      Effect.gen(function* () {
        const repo = yield* PolicyRepo;
        return yield* repo.create({
          organizationId: "org-policy-1",
          name: "clear-desc",
          description: "to be cleared",
          document: docOf("A"),
        });
      }),
    );

    const cleared = await run(
      Effect.gen(function* () {
        const repo = yield* PolicyRepo;
        return yield* repo.update({
          id: created.id,
          organizationId: "org-policy-1",
          description: null,
        });
      }),
    );
    expect(cleared).not.toBeNull();
    expect(cleared!.description).toBeNull();
    // document was not in the patch → preserved.
    expect(cleared!.document).toEqual(docOf("A"));
  });

  it("update of an absent row (or wrong org) returns null", async () => {
    const created = await run(
      Effect.gen(function* () {
        const repo = yield* PolicyRepo;
        return yield* repo.create({
          organizationId: "org-policy-1",
          name: "scoped-update",
          description: null,
          document: docOf("A"),
        });
      }),
    );

    const wrongOrg = await run(
      Effect.gen(function* () {
        const repo = yield* PolicyRepo;
        return yield* repo.update({
          id: created.id,
          organizationId: "org-policy-2",
          name: "hijack",
        });
      }),
    );
    expect(wrongOrg).toBeNull();

    const absent = await run(
      Effect.gen(function* () {
        const repo = yield* PolicyRepo;
        return yield* repo.update({
          id: "does-not-exist",
          organizationId: "org-policy-1",
          name: "ghost",
        });
      }),
    );
    expect(absent).toBeNull();
  });

  it("findDocumentsByIds returns a keyed map of real ids, tenant-scoped, skipping unknowns", async () => {
    const [first, second] = await run(
      Effect.gen(function* () {
        const repo = yield* PolicyRepo;
        const one = yield* repo.create({
          organizationId: "org-policy-1",
          name: "doc-map-1",
          description: null,
          document: docOf("X"),
        });
        const two = yield* repo.create({
          organizationId: "org-policy-1",
          name: "doc-map-2",
          description: null,
          document: docOf("Y"),
        });
        return [one, two] as const;
      }),
    );

    // A policy in the OTHER org — must not leak into the map.
    const otherOrg = await run(
      Effect.gen(function* () {
        const repo = yield* PolicyRepo;
        return yield* repo.create({
          organizationId: "org-policy-2",
          name: "doc-map-other",
          description: null,
          document: docOf("Z"),
        });
      }),
    );

    const map = await run(
      Effect.gen(function* () {
        const repo = yield* PolicyRepo;
        return yield* repo.findDocumentsByIds({
          organizationId: "org-policy-1",
          ids: [first.id, second.id, otherOrg.id, "unknown-id"],
        });
      }),
    );

    expect(map.size).toBe(2);
    expect(map.get(first.id)).toEqual(docOf("X"));
    expect(map.get(second.id)).toEqual(docOf("Y"));
    // cross-org id is filtered by the org clause.
    expect(map.has(otherOrg.id)).toBe(false);
    expect(map.has("unknown-id")).toBe(false);
  });

  it("findDocumentsByIds returns an empty map for no ids (no query)", async () => {
    const map = await run(
      Effect.gen(function* () {
        const repo = yield* PolicyRepo;
        return yield* repo.findDocumentsByIds({ organizationId: "org-policy-1", ids: [] });
      }),
    );
    expect(map.size).toBe(0);
  });

  it("delete sweeps the policy's attachments (no orphan rows)", async () => {
    const policy = await run(
      Effect.gen(function* () {
        const repo = yield* PolicyRepo;
        return yield* repo.create({
          organizationId: "org-policy-1",
          name: "with-attachments",
          description: null,
          document: docOf("A"),
        });
      }),
    );

    await insertAttachment({ id: "att-1", organizationId: "org-policy-1", policyId: policy.id });
    await insertAttachment({ id: "att-2", organizationId: "org-policy-1", policyId: policy.id });

    const before = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM "policy_attachment" WHERE "policy_id" = ?`,
    )
      .bind(policy.id)
      .first<{ n: number }>();
    expect(before!.n).toBe(2);

    await run(
      Effect.gen(function* () {
        const repo = yield* PolicyRepo;
        yield* repo.delete({ id: policy.id, organizationId: "org-policy-1" });
      }),
    );

    const after = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM "policy_attachment" WHERE "policy_id" = ?`,
    )
      .bind(policy.id)
      .first<{ n: number }>();
    expect(after!.n).toBe(0);
  });

  it("a duplicate name fails a TYPED Conflict (409), not an untyped 500 defect", async () => {
    const create = () =>
      run(
        Effect.gen(function* () {
          const repo = yield* PolicyRepo;
          return yield* repo.create({
            organizationId: "org-policy-1",
            name: "dup-policy-name",
            description: null,
            document: docOf("A"),
          });
        }).pipe(Effect.exit),
      );

    const first = await create();
    expect(Exit.isSuccess(first)).toBe(true);

    const second = await create();
    expect(Exit.isFailure(second)).toBe(true);
    // The unique-index violation surfaces as a typed Conflict (the contract's
    // `.addError(Conflict)` is reachable), NOT a defect/die that becomes a 500.
    const failure = Exit.isFailure(second)
      ? Option.getOrUndefined(Cause.failureOption(second.cause))
      : undefined;
    expect(failure?._tag).toBe("Conflict");
  });
});
