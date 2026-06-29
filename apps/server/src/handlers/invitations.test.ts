import { CreateInvitationBody } from "@better-update/api";
import { it } from "@effect/vitest";
import { Effect, Either, Exit, Schema } from "effect";

import { AuthContext } from "../auth/context";
import { assertAccess } from "../auth/policy";

import type { AuthContextShape } from "../auth/context";
import type { PolicyStatement } from "../authz-models";

// The invitations handlers gate list/create/cancel with
// `assertAccess("invitation", <action>)` at the default (org) target. This pins
// THAT contract: organization invitation create / list / cancel now flow through
// the IAM policy model, NOT better-auth's org-role `hasPermission({invitation})`
// check. An org member can invite/cancel WITHOUT being the better-auth owner —
// purely by holding an `invitation:*` allow via a policy attachment; a member
// with no such allow is denied (default-deny). We exercise the gate directly with
// a synthetic principal, mirroring `handlers/api-keys.test.ts` / `auth/policy.test.ts`.

const baseActor: AuthContextShape = {
  userId: "u1",
  organizationId: "org-1",
  memberId: "m1",
  role: "member",
  isOwner: false,
  effectiveStatements: [],
  source: "session",
  transport: "cookie",
  sessionId: "sess-test",
  actorEmail: "dev@example.com",
  isSuperadmin: false,
};

const provide = (overrides: Partial<AuthContextShape>) =>
  Effect.provideService(AuthContext, { ...baseActor, ...overrides });

const allow = (actions: string[], resources: string[]): PolicyStatement => ({
  effect: "allow",
  actions,
  resources,
});

const deny = (actions: string[], resources: string[]): PolicyStatement => ({
  effect: "deny",
  actions,
  resources,
});

const isForbidden = (effect: Effect.Effect<void, unknown>) =>
  Effect.gen(function* () {
    const exit = yield* effect.pipe(Effect.exit);
    return Exit.isFailure(exit);
  });

describe("invitations authz gate — assertAccess('invitation', …)", () => {
  it.effect("the better-auth org owner bypasses (can create + cancel with no statements)", () =>
    Effect.gen(function* () {
      const cannotCreate = yield* isForbidden(
        assertAccess("invitation", "create").pipe(provide({ isOwner: true })),
      );
      const cannotCancel = yield* isForbidden(
        assertAccess("invitation", "cancel").pipe(provide({ isOwner: true })),
      );
      expect(cannotCreate).toBe(false);
      expect(cannotCancel).toBe(false);
    }),
  );

  it.effect("a platform superadmin bypasses too", () =>
    Effect.gen(function* () {
      const cannotCreate = yield* isForbidden(
        assertAccess("invitation", "create").pipe(provide({ isSuperadmin: true })),
      );
      expect(cannotCreate).toBe(false);
    }),
  );

  it.effect(
    "a member with org-wide invitation:create / invitation:cancel allows can do both — NOT just the owner",
    () =>
      Effect.gen(function* () {
        const cannotCreate = yield* isForbidden(
          assertAccess("invitation", "create").pipe(
            provide({ effectiveStatements: [allow(["invitation:create"], ["*"])] }),
          ),
        );
        const cannotCancel = yield* isForbidden(
          assertAccess("invitation", "cancel").pipe(
            provide({ effectiveStatements: [allow(["invitation:cancel"], ["*"])] }),
          ),
        );
        expect(cannotCreate).toBe(false);
        expect(cannotCancel).toBe(false);
      }),
  );

  it.effect(
    "an 'org'-scoped invitation:* allow grants create, cancel AND read (org target path)",
    () =>
      Effect.gen(function* () {
        const wildcard = { effectiveStatements: [allow(["invitation:*"], ["org"])] };
        const cannotCreate = yield* isForbidden(
          assertAccess("invitation", "create").pipe(provide(wildcard)),
        );
        const cannotCancel = yield* isForbidden(
          assertAccess("invitation", "cancel").pipe(provide(wildcard)),
        );
        const cannotRead = yield* isForbidden(
          assertAccess("invitation", "read").pipe(provide(wildcard)),
        );
        expect(cannotCreate).toBe(false);
        expect(cannotCancel).toBe(false);
        expect(cannotRead).toBe(false);
      }),
  );

  it.effect("a member with NO invitation statement is denied for every action (default-deny)", () =>
    Effect.gen(function* () {
      const cannotCreate = yield* isForbidden(
        assertAccess("invitation", "create").pipe(provide({})),
      );
      const cannotCancel = yield* isForbidden(
        assertAccess("invitation", "cancel").pipe(provide({})),
      );
      const cannotList = yield* isForbidden(assertAccess("invitation", "read").pipe(provide({})));
      expect(cannotCreate).toBe(true);
      expect(cannotCancel).toBe(true);
      expect(cannotList).toBe(true);
    }),
  );

  it.effect("an invitation:read allow does NOT grant create or cancel (actions are scoped)", () =>
    Effect.gen(function* () {
      const readOnly = { effectiveStatements: [allow(["invitation:read"], ["*"])] };
      const canRead = yield* isForbidden(
        assertAccess("invitation", "read").pipe(provide(readOnly)),
      );
      const cannotCreate = yield* isForbidden(
        assertAccess("invitation", "create").pipe(provide(readOnly)),
      );
      const cannotCancel = yield* isForbidden(
        assertAccess("invitation", "cancel").pipe(provide(readOnly)),
      );
      // read-only principal CAN list but cannot create or cancel.
      expect(canRead).toBe(false);
      expect(cannotCreate).toBe(true);
      expect(cannotCancel).toBe(true);
    }),
  );

  it.effect("a deny on invitation:cancel wins over an allow (deny-wins)", () =>
    Effect.gen(function* () {
      const cannotCancel = yield* isForbidden(
        assertAccess("invitation", "cancel").pipe(
          provide({
            effectiveStatements: [
              allow(["invitation:*"], ["*"]),
              deny(["invitation:cancel"], ["*"]),
            ],
          }),
        ),
      );
      // The allow still lets create through; only cancel is denied.
      const cannotCreate = yield* isForbidden(
        assertAccess("invitation", "create").pipe(
          provide({
            effectiveStatements: [
              allow(["invitation:*"], ["*"]),
              deny(["invitation:cancel"], ["*"]),
            ],
          }),
        ),
      );
      expect(cannotCancel).toBe(true);
      expect(cannotCreate).toBe(false);
    }),
  );
});

// The create payload is the API trust boundary. In the unified IAM model invites
// are member-ONLY: `role` is a member literal (NEVER "admin" / "owner") — admin
// access comes from policy attachments post-accept, and "owner" is the undeniable
// root bypass that is never grantable by invite. `email` must look like an address.
describe("CreateInvitationBody schema (role allow-list + email shape)", () => {
  const decode = Schema.decodeUnknownEither(CreateInvitationBody);

  it("rejects role 'owner' (anti-escalation) and any non-member role", () => {
    expect(Either.isLeft(decode({ email: "a@b.com", role: "owner" }))).toBe(true);
    expect(Either.isLeft(decode({ email: "a@b.com", role: "superadmin" }))).toBe(true);
  });

  it("rejects role 'admin' (admin-ness now comes from policy attachments, not invite)", () => {
    expect(Either.isLeft(decode({ email: "a@b.com", role: "admin" }))).toBe(true);
  });

  it("rejects a malformed email", () => {
    expect(Either.isLeft(decode({ email: "not-an-email" }))).toBe(true);
    expect(Either.isLeft(decode({ email: "" }))).toBe(true);
  });

  it("accepts member / omitted role with a valid email", () => {
    expect(Either.isRight(decode({ email: "a@b.com" }))).toBe(true);
    expect(Either.isRight(decode({ email: "a@b.com", role: "member" }))).toBe(true);
  });
});
