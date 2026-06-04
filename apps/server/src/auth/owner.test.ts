import { roleIsOwner } from "./owner";

describe(roleIsOwner, () => {
  it("is true only for the exact string 'owner'", () => {
    expect(roleIsOwner("owner")).toBe(true);
  });

  it("is false for comma-lists, casing variants, and look-alikes (anti-escalation)", () => {
    const notOwner = [
      "admin,owner",
      "owner,admin",
      "Owner",
      "OWNER",
      "notowner",
      "ownership",
      "own",
      "",
    ];
    for (const role of notOwner) {
      expect(roleIsOwner(role)).toBe(false);
    }
  });
});
