// Asserts the matrix data matches docs/specs/authz/GITLAB-RBAC-SPEC.md §2 and
// the pure evaluation helpers implement the ladder semantics.

import {
  anywhereRank,
  boundCredentialAllowed,
  CREDENTIAL_RULES,
  credentialRequiredRank,
  effectiveProjectRole,
  maxProjectRole,
  meetsAnywhereRequirement,
  meetsOrgRequirement,
  ORG_RULES,
  orgGlobalEnvVarRequirement,
  PROJECT_RULES,
  projectRoleAtLeast,
} from "./role-matrix";

import type { RoleContext } from "./role-matrix";

const memberCtx = (projectRoles: RoleContext["projectRoles"]): RoleContext => ({
  orgRole: "member",
  projectRoles,
});

describe("ladder primitives", () => {
  it("ranks reporter < developer < maintainer", () => {
    expect(projectRoleAtLeast("maintainer", "developer")).toBe(true);
    expect(projectRoleAtLeast("developer", "maintainer")).toBe(false);
    expect(projectRoleAtLeast("reporter", "reporter")).toBe(true);
    expect(projectRoleAtLeast(null, "reporter")).toBe(false);
  });

  it("maxProjectRole picks the higher rank and tolerates null", () => {
    expect(maxProjectRole("reporter", "developer")).toBe("developer");
    expect(maxProjectRole("maintainer", null)).toBe("maintainer");
    expect(maxProjectRole(null, null)).toBeNull();
  });
});

describe(effectiveProjectRole, () => {
  it("org owner/admin are implicit maintainers everywhere", () => {
    expect(effectiveProjectRole({ orgRole: "owner", projectRoles: {} }, "p1")).toBe("maintainer");
    expect(effectiveProjectRole({ orgRole: "admin", projectRoles: {} }, "p1")).toBe("maintainer");
  });

  it("plain members get exactly their membership row, absent row = null", () => {
    const ctx = memberCtx({ p1: "developer" });
    expect(effectiveProjectRole(ctx, "p1")).toBe("developer");
    expect(effectiveProjectRole(ctx, "p2")).toBeNull();
  });
});

describe("anywhereRank (spec §1a)", () => {
  it("is maintainer for org owner/admin regardless of rows", () => {
    expect(anywhereRank({ orgRole: "admin", projectRoles: {} })).toBe("maintainer");
  });

  it("is the highest membership row for plain members", () => {
    expect(anywhereRank(memberCtx({ alpha: "reporter", beta: "developer" }))).toBe("developer");
    expect(anywhereRank(memberCtx({}))).toBeNull();
  });

  it("meetsAnywhereRequirement compares against that rank", () => {
    expect(meetsAnywhereRequirement(memberCtx({ alpha: "developer" }), "developer")).toBe(true);
    expect(meetsAnywhereRequirement(memberCtx({ alpha: "developer" }), "maintainer")).toBe(false);
  });
});

describe("org requirement ladder", () => {
  it("member-level rules pass every org role", () => {
    expect(meetsOrgRequirement("member", "member")).toBe(true);
  });

  it("admin-level rules require admin or owner", () => {
    expect(meetsOrgRequirement("member", "admin")).toBe(false);
    expect(meetsOrgRequirement("admin", "admin")).toBe(true);
    expect(meetsOrgRequirement("owner", "admin")).toBe(true);
  });

  it("owner-level rules require owner", () => {
    expect(meetsOrgRequirement("admin", "owner")).toBe(false);
    expect(meetsOrgRequirement("owner", "owner")).toBe(true);
  });
});

describe("matrix content matches spec §2", () => {
  it("project-scoped table", () => {
    expect(PROJECT_RULES["project:read"]).toBe("reporter");
    expect(PROJECT_RULES["project:update"]).toBe("maintainer");
    expect(PROJECT_RULES["project:delete"]).toBeUndefined();
    expect(PROJECT_RULES["update:create"]).toBe("developer");
    expect(PROJECT_RULES["update:delete"]).toBe("maintainer");
    expect(PROJECT_RULES["channel:delete"]).toBe("maintainer");
    expect(PROJECT_RULES["branch:create"]).toBe("developer");
    expect(PROJECT_RULES["build:download"]).toBe("reporter");
    expect(PROJECT_RULES["submission:cancel"]).toBe("developer");
    expect(PROJECT_RULES["envVar:update"]).toBe("developer");
    expect(PROJECT_RULES["rollout:update"]).toBe("developer");
    expect(PROJECT_RULES["iosBundleConfiguration:delete"]).toBe("maintainer");
  });

  it("org-scoped table", () => {
    expect(ORG_RULES["organization:read"]).toBe("member");
    expect(ORG_RULES["organization:update"]).toBe("admin");
    expect(ORG_RULES["member:read"]).toBe("member");
    expect(ORG_RULES["member:update"]).toBe("admin");
    expect(ORG_RULES["invitation:create"]).toBe("admin");
    // Robots are project-scoped (spec §1b, v2): managing them is Maintainer
    // work on the robot's project, not org administration.
    expect(ORG_RULES["robotAccount:create"]).toBeUndefined();
    expect(PROJECT_RULES["robotAccount:create"]).toBe("maintainer");
    expect(PROJECT_RULES["robotAccount:delete"]).toBe("maintainer");
    // Bindings are org administration (spec §1a).
    expect(ORG_RULES["credentialBinding:create"]).toBe("admin");
    expect(ORG_RULES["credentialBinding:delete"]).toBe("admin");
    expect(ORG_RULES["vaultAccess:read"]).toBe("admin");
    expect(ORG_RULES["auditLog:read"]).toBe("admin");
    expect(ORG_RULES["webhook:update"]).toBe("admin");
    expect(ORG_RULES["environment:read"]).toBe("member");
    expect(ORG_RULES["environment:update"]).toBe("admin");
    expect(ORG_RULES["billing:read"]).toBe("owner");
    expect(ORG_RULES["project:create"]).toBe("member");
    expect(ORG_RULES["project:delete"]).toBe("admin");
  });

  it("bound-credential base ranks (spec §1a, v2)", () => {
    expect(CREDENTIAL_RULES["device:create"]).toBe("developer");
    expect(CREDENTIAL_RULES["appleCredential:download"]).toBe("developer");
    expect(CREDENTIAL_RULES["appleCredential:delete"]).toBe("maintainer");
    expect(CREDENTIAL_RULES["androidCredential:read"]).toBe("developer");
    // envVar:read left the credential table — org-global env reads are the
    // one surviving anywhere-rank rule (orgGlobalEnvVarRequirement).
    expect(CREDENTIAL_RULES["envVar:read"]).toBeUndefined();
  });

  it("boundCredentialAllowed requires the rank on a BOUND project (§1a)", () => {
    const developerOnBound = memberCtx({ projBound: "developer" });
    expect(boundCredentialAllowed(developerOnBound, ["projBound"], "developer")).toBe(true);
    expect(boundCredentialAllowed(developerOnBound, ["projBound"], "maintainer")).toBe(false);
    // Rank elsewhere grants nothing; unbound = admin-only.
    expect(boundCredentialAllowed(developerOnBound, ["projOther"], "developer")).toBe(false);
    expect(boundCredentialAllowed(developerOnBound, [], "developer")).toBe(false);
    expect(boundCredentialAllowed({ orgRole: "admin", projectRoles: {} }, [], "maintainer")).toBe(
      true,
    );
  });

  it("protected credentials raise the requirement to maintainer (§3b)", () => {
    expect(credentialRequiredRank("developer", false)).toBe("developer");
    expect(credentialRequiredRank("developer", true)).toBe("maintainer");
    expect(credentialRequiredRank("maintainer", true)).toBe("maintainer");
  });

  it("org-global env vars: reads at developer-anywhere, writes admin-only", () => {
    expect(orgGlobalEnvVarRequirement("read")).toBe("anywhere-read");
    expect(orgGlobalEnvVarRequirement("update")).toBe("admin");
    expect(orgGlobalEnvVarRequirement("delete")).toBe("admin");
  });
});
