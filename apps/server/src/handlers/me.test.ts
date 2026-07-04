import { actorHolds, avatarRejectionReason } from "./me";

import type { CurrentActor } from "../models";

// `actorHolds(ctx, resource, action)` is the server-computed capability the UI
// gates each affordance on, mirroring the EXACT org rule its endpoint gates on
// (GITLAB-RBAC-SPEC §2). It must never report a capability the server would
// 403. Owner and superadmin are unconditional roots (same bypass order as
// assertAccess); everything else follows the fixed org ladder.

const baseActor: CurrentActor = {
  userId: "u1",
  organizationId: "org-1",
  memberId: "m1",
  role: "member",
  orgRole: "member",
  isOwner: false,
  projectRoles: {},
  source: "session",
  transport: "cookie",
  sessionId: "sess-test",
  actorEmail: "dev@example.com",
  isSuperadmin: false,
  robotId: null,
};

const actor = (overrides: Partial<CurrentActor>): CurrentActor => ({ ...baseActor, ...overrides });

describe(actorHolds, () => {
  it("owner + superadmin hold every capability", () => {
    expect(actorHolds(actor({ isOwner: true }), "invitation", "create")).toBe(true);
    expect(actorHolds(actor({ isSuperadmin: true }), "member", "delete")).toBe(true);
    expect(actorHolds(actor({ isOwner: true }), "billing", "update")).toBe(true);
  });

  it("a plain member holds no admin capability (default-deny)", () => {
    expect(actorHolds(actor({}), "invitation", "create")).toBe(false);
    expect(actorHolds(actor({}), "member", "delete")).toBe(false);
    expect(actorHolds(actor({}), "vaultAccess", "read")).toBe(false);
  });

  it("org admin holds the admin-tier capabilities but not owner-tier ones", () => {
    const admin = actor({ orgRole: "admin" });
    expect(actorHolds(admin, "invitation", "create")).toBe(true);
    expect(actorHolds(admin, "member", "delete")).toBe(true);
    // Robots are project-scoped now (spec §1b, v2) — no org-level token.
    expect(actorHolds(admin, "robotAccount", "create")).toBe(false);
    expect(actorHolds(admin, "credentialBinding", "create")).toBe(true);
    expect(actorHolds(admin, "organization", "update")).toBe(true);
    expect(actorHolds(admin, "billing", "update")).toBe(false);
  });

  it("member-tier reads are held by every member", () => {
    expect(actorHolds(actor({}), "member", "read")).toBe(true);
    expect(actorHolds(actor({}), "organization", "read")).toBe(true);
  });

  it("project roles never confer org capabilities", () => {
    const projectMaintainer = actor({ projectRoles: { projA: "maintainer" } });
    expect(actorHolds(projectMaintainer, "invitation", "create")).toBe(false);
    expect(actorHolds(projectMaintainer, "auditLog", "read")).toBe(false);
  });
});

// `setAvatar` gates the uploaded R2 object on these rules, since a presigned PUT
// can neither cap its own size nor fully constrain its type. Mirrors the shared
// logo cap (2 MiB) and image allow-list, worded for the avatar.
describe(avatarRejectionReason, () => {
  it("accepts each allowed image type within the size cap", () => {
    const types = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
    for (const contentType of types) {
      expect(avatarRejectionReason({ size: 1024, contentType })).toBeNull();
    }
  });

  it("accepts a missing content type (R2 recorded none)", () => {
    expect(avatarRejectionReason({ size: 1024, contentType: null })).toBeNull();
  });

  it("accepts an object exactly at the 2 MiB boundary", () => {
    expect(avatarRejectionReason({ size: 2_097_152, contentType: "image/png" })).toBeNull();
  });

  it("rejects an object larger than 2 MiB", () => {
    expect(avatarRejectionReason({ size: 2_097_153, contentType: "image/png" })).toBe(
      "Avatar must be 2 MB or smaller",
    );
  });

  it("rejects a disallowed content type", () => {
    expect(avatarRejectionReason({ size: 1024, contentType: "image/gif" })).toBe(
      "Unsupported avatar type: image/gif",
    );
  });

  it("checks the size cap before the content type", () => {
    expect(avatarRejectionReason({ size: 9_999_999, contentType: "image/gif" })).toBe(
      "Avatar must be 2 MB or smaller",
    );
  });
});
