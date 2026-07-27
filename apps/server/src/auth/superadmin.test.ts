import { isSuperadminEmail, parseSuperadminEmails, roleIsSuperadmin } from "./superadmin";

describe(parseSuperadminEmails, () => {
  it("returns empty set for undefined or blank", () => {
    expect(parseSuperadminEmails(undefined).size).toBe(0);
    expect(parseSuperadminEmails("").size).toBe(0);
    expect(parseSuperadminEmails("  ").size).toBe(0);
  });

  it("splits, trims, lowercases and drops empties", () => {
    const set = parseSuperadminEmails(" Owner.One@Example.com , a@b.com ,,");
    expect([...set]).toStrictEqual(["owner.one@example.com", "a@b.com"]);
  });
});

describe(isSuperadminEmail, () => {
  const superadmins = parseSuperadminEmails("owner.one@example.com");

  it("matches case-insensitively after trimming", () => {
    expect(isSuperadminEmail("Owner.One@example.com", superadmins)).toBe(true);
    expect(isSuperadminEmail("  owner.one@example.com ", superadmins)).toBe(true);
  });

  it("rejects non-members and nullish", () => {
    expect(isSuperadminEmail("someone@else.com", superadmins)).toBe(false);
    expect(isSuperadminEmail(null, superadmins)).toBe(false);
    expect(isSuperadminEmail(undefined, superadmins)).toBe(false);
  });
});

describe(roleIsSuperadmin, () => {
  it("true when role list contains admin", () => {
    expect(roleIsSuperadmin("admin")).toBe(true);
    expect(roleIsSuperadmin("user,admin")).toBe(true);
    expect(roleIsSuperadmin(" admin , user ")).toBe(true);
  });

  it("false otherwise", () => {
    expect(roleIsSuperadmin("user")).toBe(false);
    expect(roleIsSuperadmin("administrator")).toBe(false);
    expect(roleIsSuperadmin(null)).toBe(false);
    expect(roleIsSuperadmin(undefined)).toBe(false);
  });
});
