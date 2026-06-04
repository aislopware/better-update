import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { Effect } from "effect";

import worker from "../../../src";
import { InvitationRepo, InvitationRepoLive } from "../../../src/repositories/invitations";
import { runWithLayerAndEnv } from "../../helpers/runtime";

import type { InvitationModel } from "../../../src/repositories/invitations";

// ── The linchpin ──────────────────────────────────────────────────
// PROVE that an `invitation` row written by `InvitationRepo.create` (the
// IAM-gated create path) is accepted by better-auth's OWN
// `/organization/accept-invitation` handler. The repo never touches better-auth
// code; this drives the real plugin route over `worker.fetch` and asserts a
// `member` row materializes — the only honest proof that our hand-written row is
// shape-compatible with the handler we deliberately did NOT replace.

// `InvitationRepoLive` has no extra requirements (only `cloudflareEnv`), so it
// runs straight against local D1 via `runWithLayerAndEnv`.
const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, InvitationRepo>) =>
  runWithLayerAndEnv(effect, InvitationRepoLive, env);

// `BETTER_AUTH_URL` in the integration project; every state-changing better-auth
// POST must carry a matching `Origin` or its CSRF guard rejects the cookie request
// with `MISSING_OR_NULL_ORIGIN` (a browser always sends one).
const ORIGIN = "http://localhost";

const request = (url: string, init?: RequestInit) => {
  const req = new Request(`${ORIGIN}${url}`, init);
  const ctx = createExecutionContext();
  return worker.fetch(req, env, ctx).then(async (response) => {
    await waitOnExecutionContext(ctx);
    return response;
  });
};

const jsonPost = (url: string, body: unknown, cookie?: string) =>
  request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: JSON.stringify(body),
  });

// better-auth sets the session cookie on the response; carry it forward verbatim.
const parseCookies = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

const insertOrg = (id: string) =>
  env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(id, `Org ${id}`, `${id}-slug`, "2026-01-01T00:00:00Z")
    .run();

// A bare `user` row to FK-back `invitation.inviter_id` (the inviter need not be a
// member for accept — accept builds the member from the recipient session).
const insertUser = (id: string, email: string) =>
  env.DB.prepare(
    `INSERT INTO "user" ("id", "name", "email", "email_verified", "approved", "created_at", "updated_at")
     VALUES (?, ?, ?, 1, 1, ?, ?)`,
  )
    .bind(id, `User ${id}`, email, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z")
    .run();

// Sign a fresh user up via better-auth, then mark them verified + approved (the
// org plugin's accept handler requires `session.user.emailVerified`). Re-sign-in
// after the update so the returned cookies reflect the verified state, and return
// those cookies plus the new user's id.
const signUpVerifiedUser = async (params: {
  readonly name: string;
  readonly email: string;
  readonly password: string;
}): Promise<{ readonly userId: string; readonly cookies: string }> => {
  const signUp = await jsonPost("/api/auth/sign-up/email", params);
  expect(signUp.status).toBe(200);
  const signUpBody = (await signUp.json()) as { user: { id: string } };
  const userId = signUpBody.user.id;

  await env.DB.prepare(`UPDATE "user" SET "email_verified" = 1, "approved" = 1 WHERE "id" = ?`)
    .bind(userId)
    .run();

  const signIn = await jsonPost("/api/auth/sign-in/email", {
    email: params.email,
    password: params.password,
  });
  expect(signIn.status).toBe(200);
  return { userId, cookies: parseCookies(signIn) };
};

interface MemberRow {
  readonly id: string;
  readonly role: string;
  readonly user_id: string;
}

const findMember = (organizationId: string, userId: string) =>
  env.DB.prepare(
    `SELECT "id", "role", "user_id" FROM "member" WHERE "organization_id" = ? AND "user_id" = ?`,
  )
    .bind(organizationId, userId)
    .first<MemberRow>();

interface InvitationRow {
  readonly id: string;
  readonly organization_id: string;
  readonly email: string;
  readonly role: string | null;
  readonly status: string;
  readonly expires_at: string;
  readonly inviter_id: string;
}

const findInvitationRow = (id: string) =>
  env.DB.prepare(
    `SELECT "id", "organization_id", "email", "role", "status", "expires_at", "inviter_id"
     FROM "invitation" WHERE "id" = ?`,
  )
    .bind(id)
    .first<InvitationRow>();

const createInvitation = (params: {
  readonly organizationId: string;
  readonly email: string;
  readonly role: string;
  readonly inviterUserId: string;
}): Promise<InvitationModel> =>
  run(
    Effect.gen(function* () {
      const repo = yield* InvitationRepo;
      return yield* repo.create(params);
    }),
  );

// ── Tests ─────────────────────────────────────────────────────────

describe("InvitationRepo.create → better-auth accept-invitation (THE LINCHPIN)", () => {
  it("a row WE write is accepted by better-auth's own accept handler → a member is created", async () => {
    const org = "org-invite-accept-1";
    await insertOrg(org);
    await insertUser("user-invite-inviter-1", "inviter-1@example.com");

    const invited = await signUpVerifiedUser({
      name: "Invitee One",
      email: "invitee-accept-1@example.com",
      password: "SecureP@ss123",
    });

    // The unit under test writes the pending row.
    const created = await createInvitation({
      organizationId: org,
      email: "invitee-accept-1@example.com",
      role: "member",
      inviterUserId: "user-invite-inviter-1",
    });
    expect(created.status).toBe("pending");

    // THE GATE: better-auth's own accept path must consume the row WE inserted.
    const accept = await jsonPost(
      "/api/auth/organization/accept-invitation",
      { invitationId: created.id },
      invited.cookies,
    );
    expect(accept.status).toBe(200);

    // A member row now exists for the invited user, carrying the invitation role.
    const member = await findMember(org, invited.userId);
    expect(member).not.toBeNull();
    expect(member?.user_id).toBe(invited.userId);
    expect(member?.role).toBe("member");

    // And better-auth flipped the invitation to "accepted".
    const acceptedRow = await findInvitationRow(created.id);
    expect(acceptedRow?.status).toBe("accepted");
  });

  it("the invitation role is honored verbatim by accept (member → member.role = member)", async () => {
    const org = "org-invite-accept-2";
    await insertOrg(org);
    await insertUser("user-invite-inviter-2", "inviter-2@example.com");

    const invited = await signUpVerifiedUser({
      name: "Invitee Two",
      email: "invitee-accept-2@example.com",
      password: "SecureP@ss123",
    });

    // Under the IAM collapse the only invitable role is "member" (admin/developer/
    // viewer come from policy attachments, never the invite role). This guards that
    // better-auth's accept-invitation still stamps the invitation's role onto the
    // new member row verbatim — for the one role our clients ever mint.
    const created = await createInvitation({
      organizationId: org,
      email: "invitee-accept-2@example.com",
      role: "member",
      inviterUserId: "user-invite-inviter-2",
    });

    const accept = await jsonPost(
      "/api/auth/organization/accept-invitation",
      { invitationId: created.id },
      invited.cookies,
    );
    expect(accept.status).toBe(200);

    const member = await findMember(org, invited.userId);
    expect(member?.role).toBe("member");
  });

  it("a CANCELED invitation can no longer be accepted (status guard)", async () => {
    const org = "org-invite-accept-3";
    await insertOrg(org);
    await insertUser("user-invite-inviter-3", "inviter-3@example.com");

    const invited = await signUpVerifiedUser({
      name: "Invitee Three",
      email: "invitee-accept-3@example.com",
      password: "SecureP@ss123",
    });

    const created = await createInvitation({
      organizationId: org,
      email: "invitee-accept-3@example.com",
      role: "member",
      inviterUserId: "user-invite-inviter-3",
    });

    // Cancel via the repo (soft: status → "canceled"), then accept must fail.
    const canceled = await run(
      Effect.gen(function* () {
        const repo = yield* InvitationRepo;
        return yield* repo.cancel({ id: created.id, organizationId: org });
      }),
    );
    expect(canceled).toBe(true);

    const accept = await jsonPost(
      "/api/auth/organization/accept-invitation",
      { invitationId: created.id },
      invited.cookies,
    );
    expect(accept.status).not.toBe(200);

    // No member materialized.
    const member = await findMember(org, invited.userId);
    expect(member).toBeNull();
  });
});

describe("InvitationRepo.create — accept-precondition columns (field-by-field proxy)", () => {
  it("the written row matches better-auth accept's WHERE/guards exactly", async () => {
    const org = "org-invite-cols-1";
    await insertOrg(org);
    await insertUser("user-invite-inviter-cols", "inviter-cols@example.com");

    const before = Date.now();
    const created = await createInvitation({
      organizationId: org,
      email: "invitee-cols@example.com",
      role: "member",
      inviterUserId: "user-invite-inviter-cols",
    });
    const after = Date.now();

    const row = await findInvitationRow(created.id);
    expect(row).not.toBeNull();
    // accept L248: status MUST be exactly "pending".
    expect(row?.status).toBe("pending");
    // accept L248: expiresAt (read via `new Date(value)`) MUST be in the future.
    const expiresAtMs = new Date(row?.expires_at ?? "").getTime();
    expect(Number.isNaN(expiresAtMs)).toBe(false);
    expect(expiresAtMs).toBeGreaterThan(after);
    // 48h default expiry (matches the plugin's invitationExpiresIn), within slack.
    const fortyEightHours = 48 * 60 * 60 * 1000;
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + fortyEightHours - 5_000);
    expect(expiresAtMs).toBeLessThanOrEqual(after + fortyEightHours + 5_000);
    // accept L249: email is stored verbatim (case preserved; accept lowercases both sides).
    expect(row?.email).toBe("invitee-cols@example.com");
    // accept L247/L290: org + role drive findOrganizationById + createMember.
    expect(row?.organization_id).toBe(org);
    expect(row?.role).toBe("member");
    // accept builds the member from the recipient session, but the row's
    // inviter_id FK must reference a real user (NOT NULL FK).
    expect(row?.inviter_id).toBe("user-invite-inviter-cols");
    // ISO-8601 string format (better-auth sqlite adapter supportsDates:false).
    expect(row?.expires_at).toBe(new Date(expiresAtMs).toISOString());
  });
});

describe("InvitationRepo.list / cancel — org-scoped", () => {
  it("lists an org's invitations newest-first across statuses; cancel is org-scoped", async () => {
    const orgA = "org-invite-scope-A";
    const orgB = "org-invite-scope-B";
    await insertOrg(orgA);
    await insertOrg(orgB);
    await insertUser("user-invite-inviter-scope", "inviter-scope@example.com");

    const inA1 = await createInvitation({
      organizationId: orgA,
      email: "a1@example.com",
      role: "member",
      inviterUserId: "user-invite-inviter-scope",
    });
    const inA2 = await createInvitation({
      organizationId: orgA,
      email: "a2@example.com",
      role: "member",
      inviterUserId: "user-invite-inviter-scope",
    });
    const inB1 = await createInvitation({
      organizationId: orgB,
      email: "b1@example.com",
      role: "member",
      inviterUserId: "user-invite-inviter-scope",
    });

    const listedA = await run(
      Effect.gen(function* () {
        const repo = yield* InvitationRepo;
        return yield* repo.list({ organizationId: orgA });
      }),
    );
    const emailsA = listedA.map((model) => model.email);
    expect(emailsA).toContain("a1@example.com");
    expect(emailsA).toContain("a2@example.com");
    // orgB's invite never leaks into orgA's list.
    expect(emailsA).not.toContain("b1@example.com");

    // Cross-org cancel is a no-op (the org clause excludes it).
    const crossOrg = await run(
      Effect.gen(function* () {
        const repo = yield* InvitationRepo;
        return yield* repo.cancel({ id: inB1.id, organizationId: orgA });
      }),
    );
    expect(crossOrg).toBe(false);
    expect((await findInvitationRow(inB1.id))?.status).toBe("pending");

    // Same-org cancel succeeds; a second cancel reports not-pending → false.
    const first = await run(
      Effect.gen(function* () {
        const repo = yield* InvitationRepo;
        return yield* repo.cancel({ id: inA1.id, organizationId: orgA });
      }),
    );
    expect(first).toBe(true);
    expect((await findInvitationRow(inA1.id))?.status).toBe("canceled");

    const again = await run(
      Effect.gen(function* () {
        const repo = yield* InvitationRepo;
        return yield* repo.cancel({ id: inA1.id, organizationId: orgA });
      }),
    );
    expect(again).toBe(false);

    // A canceled invite still appears in the list (soft cancel keeps the row).
    const listedAfter = await run(
      Effect.gen(function* () {
        const repo = yield* InvitationRepo;
        return yield* repo.list({ organizationId: orgA });
      }),
    );
    const canceledEntry = listedAfter.find((model) => model.id === inA1.id);
    expect(canceledEntry?.status).toBe("canceled");
    // Still-pending sibling untouched.
    expect(listedAfter.find((model) => model.id === inA2.id)?.status).toBe("pending");
  });
});
