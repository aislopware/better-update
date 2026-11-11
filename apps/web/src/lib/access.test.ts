import { canCreateOrganization } from "./access";

describe(canCreateOrganization, () => {
  const approved = { approved: true, role: "user" };
  const unapproved = { approved: false, role: "user" };
  const superadmin = { approved: false, role: "admin" };

  it("lets any approved user or superadmin create under the approved policy", () => {
    expect(canCreateOrganization(approved, "approved")).toBe(true);
    expect(canCreateOrganization(superadmin, "approved")).toBe(true);
    expect(canCreateOrganization(unapproved, "approved")).toBe(false);
  });

  it("restricts creation to superadmins under the superadmin policy", () => {
    expect(canCreateOrganization(approved, "superadmin")).toBe(false);
    expect(canCreateOrganization(superadmin, "superadmin")).toBe(true);
  });
});
