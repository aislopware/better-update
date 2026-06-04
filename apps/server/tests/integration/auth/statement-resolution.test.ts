import { env } from "cloudflare:test";
import { Effect, Layer } from "effect";

import { MANAGED_POLICIES } from "../../../src/auth/managed-policies";
import {
  inlinePermissionStatements,
  resolveEffectiveStatements,
  statementsForPrincipals,
} from "../../../src/auth/middleware";
import { GroupRepo, GroupRepoLive } from "../../../src/repositories/group-repo";
import {
  PolicyAttachmentRepo,
  PolicyAttachmentRepoLive,
} from "../../../src/repositories/policy-attachment-repo";
import { PolicyRepo, PolicyRepoLive } from "../../../src/repositories/policy-repo";
import { runWithLayerAndEnv } from "../../helpers/runtime";

import type { PolicyDocument, PolicyStatement } from "../../../src/models";

// `resolveEffectiveStatements` needs the three policy repos as requirements; we
// provide the real D1-backed Live layers so resolution runs against actual rows.
const REPOS = Layer.mergeAll(PolicyAttachmentRepoLive, GroupRepoLive, PolicyRepoLive);

const run = <Ret, Err>(
  effect: Effect.Effect<Ret, Err, PolicyAttachmentRepo | GroupRepo | PolicyRepo>,
) => runWithLayerAndEnv(effect, REPOS, env);

// ── Fixtures ──────────────────────────────────────────────────────

const ORG = "org-resolve-1";
const MEMBER = "member-resolve-alice";
// A better-auth api-key row id, used as an `apikey` policy-attachment principal.
const API_KEY = "apikey-resolve-1";

const scopedDoc: PolicyDocument = {
  statements: [
    { effect: "allow", actions: ["channel:create", "channel:update"], resources: ["project/A"] },
  ],
};

const denyDoc: PolicyDocument = {
  statements: [{ effect: "deny", actions: ["channel:delete"], resources: ["project/A"] }],
};

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

const insertMember = (id: string, organizationId: string, userId: string) =>
  env.DB.prepare(
    `INSERT INTO "member" ("id", "organization_id", "user_id", "role", "created_at") VALUES (?, ?, ?, 'member', ?)`,
  )
    .bind(id, organizationId, userId, "2026-01-01T00:00:00Z")
    .run();

// Statement equality independent of array order.
const sortStatements = (statements: readonly PolicyStatement[]) =>
  [...statements].map((statement) => JSON.stringify(statement)).sort();

// ── Setup ─────────────────────────────────────────────────────────

let groupOneId: string;
let groupTwoId: string;
let realPolicyId: string;

beforeAll(async () => {
  await insertOrg(ORG);
  await insertUser("user-resolve-alice");
  await insertMember(MEMBER, ORG, "user-resolve-alice");

  // Member belongs to TWO groups; a real scoped policy + a managed preset get
  // attached across the groups, plus a direct deny policy on the member.
  const setup = await run(
    Effect.gen(function* () {
      const groupRepo = yield* GroupRepo;
      const policyRepo = yield* PolicyRepo;
      const attachRepo = yield* PolicyAttachmentRepo;

      const groupOne = yield* groupRepo.create({
        organizationId: ORG,
        name: "resolve-grp-1",
        description: null,
      });
      const groupTwo = yield* groupRepo.create({
        organizationId: ORG,
        name: "resolve-grp-2",
        description: null,
      });
      yield* groupRepo.addMember({ groupId: groupOne.id, memberId: MEMBER });
      yield* groupRepo.addMember({ groupId: groupTwo.id, memberId: MEMBER });

      const scopedPolicy = yield* policyRepo.create({
        organizationId: ORG,
        name: "scoped-project-A",
        description: null,
        document: scopedDoc,
      });
      const directDeny = yield* policyRepo.create({
        organizationId: ORG,
        name: "direct-deny",
        description: null,
        document: denyDoc,
      });

      // group 1: managed preset (admin) — resolves from code, zero query.
      yield* attachRepo.attach({
        organizationId: ORG,
        policyId: "managed:admin",
        principal: { type: "group", id: groupOne.id },
      });
      // group 2: a real scoped policy — resolves via findDocumentsByIds.
      yield* attachRepo.attach({
        organizationId: ORG,
        policyId: scopedPolicy.id,
        principal: { type: "group", id: groupTwo.id },
      });
      // direct member attachment: a deny policy.
      yield* attachRepo.attach({
        organizationId: ORG,
        policyId: directDeny.id,
        principal: { type: "member", id: MEMBER },
      });

      // api-key principal: a managed preset + a real scoped policy, so the
      // machine-credential grant path is exercised (not just default-deny).
      yield* attachRepo.attach({
        organizationId: ORG,
        policyId: "managed:viewer",
        principal: { type: "apikey", id: API_KEY },
      });
      yield* attachRepo.attach({
        organizationId: ORG,
        policyId: scopedPolicy.id,
        principal: { type: "apikey", id: API_KEY },
      });

      return { groupOne, groupTwo, scopedPolicy } as const;
    }),
  );

  groupOneId = setup.groupOne.id;
  groupTwoId = setup.groupTwo.id;
  realPolicyId = setup.scopedPolicy.id;
});

// ── Tests ─────────────────────────────────────────────────────────

describe("resolveEffectiveStatements — D1 integration", () => {
  it("resolves the UNION of managed preset + real scoped policy + direct policy attachments", async () => {
    const statements = await run(
      resolveEffectiveStatements({
        organizationId: ORG,
        memberId: MEMBER,
      }),
    );

    const got = sortStatements(statements);

    // managed:admin (via group 1) contributes its full org-wide statement set.
    for (const stmt of MANAGED_POLICIES["managed:admin"].document.statements) {
      expect(got).toContain(JSON.stringify(stmt));
    }
    // the real scoped policy (via group 2) contributes its project/A allows.
    for (const stmt of scopedDoc.statements) {
      expect(got).toContain(JSON.stringify(stmt));
    }
    // the direct deny policy contributes the deny statement.
    for (const stmt of denyDoc.statements) {
      expect(got).toContain(JSON.stringify(stmt));
    }
  });

  it("derives NO statements from the member.role string — only attachments grant access (spec §8)", async () => {
    // A fresh member whose role is a managed preset name ("viewer" / "admin") but
    // who has NO policy/group attachment resolves to ZERO statements: privilege
    // flows exclusively through `policy_attachment`, never the role string.
    await insertUser("user-resolve-carol");
    await insertMember("member-resolve-carol", ORG, "user-resolve-carol");
    await env.DB.prepare(`UPDATE "member" SET "role" = 'admin' WHERE "id" = ?`)
      .bind("member-resolve-carol")
      .run();

    const statements = await run(
      resolveEffectiveStatements({
        organizationId: ORG,
        memberId: "member-resolve-carol",
      }),
    );
    expect(statements).toEqual([]);
  });

  it("a member with no groups and no attachments resolves to empty", async () => {
    await insertUser("user-resolve-bob");
    await insertMember("member-resolve-bob", ORG, "user-resolve-bob");

    const statements = await run(
      resolveEffectiveStatements({
        organizationId: ORG,
        memberId: "member-resolve-bob",
      }),
    );
    // no attachments → empty (no role baseline).
    expect(statements).toEqual([]);
  });

  it("real-policy resolution is tenant-scoped (a same-named principal in another org sees nothing)", async () => {
    // The member lives in ORG; resolving against a different org id finds no
    // attachments for its group/member principal ids.
    const statements = await run(
      resolveEffectiveStatements({
        organizationId: "org-resolve-other",
        memberId: MEMBER,
      }),
    );
    expect(statements).toEqual([]);
  });

  it("exposes the seeded group ids and real policy id for traceability", () => {
    expect(groupOneId).toBeTruthy();
    expect(groupTwoId).toBeTruthy();
    expect(realPolicyId).toBeTruthy();
  });
});

describe("statementsForPrincipals — api-key principal (machine credential)", () => {
  it("resolves attachment-derived statements for an api key (POSITIVE grant)", async () => {
    const statements = await run(
      statementsForPrincipals({
        organizationId: ORG,
        principals: [{ type: "apikey", id: API_KEY }],
      }),
    );
    const got = sortStatements(statements);
    // managed:viewer (read-only) + the real project/A scoped policy are both granted.
    for (const stmt of MANAGED_POLICIES["managed:viewer"].document.statements) {
      expect(got).toContain(JSON.stringify(stmt));
    }
    for (const stmt of scopedDoc.statements) {
      expect(got).toContain(JSON.stringify(stmt));
    }
  });

  it("an api key with no attachment resolves to empty (default-deny, no admin baseline)", async () => {
    const statements = await run(
      statementsForPrincipals({
        organizationId: ORG,
        principals: [{ type: "apikey", id: "apikey-unattached" }],
      }),
    );
    expect(statements).toEqual([]);
  });

  it("api-key resolution is tenant-scoped (same key id, other org → nothing)", async () => {
    const statements = await run(
      statementsForPrincipals({
        organizationId: "org-resolve-other",
        principals: [{ type: "apikey", id: API_KEY }],
      }),
    );
    expect(statements).toEqual([]);
  });
});

describe("inlinePermissionStatements — api-key inline metadata (additive)", () => {
  it("null / empty / empty-action maps contribute nothing", () => {
    expect(inlinePermissionStatements(null)).toEqual([]);
    expect(inlinePermissionStatements({})).toEqual([]);
    expect(inlinePermissionStatements({ channel: [] })).toEqual([]);
  });

  it("maps a populated map to org-wide allow statements", () => {
    expect(inlinePermissionStatements({ channel: ["read", "create"] })).toEqual([
      { effect: "allow", actions: ["channel:read", "channel:create"], resources: ["*"] },
    ]);
  });
});
