import { matchesQuery } from "./members";

describe(matchesQuery, () => {
  it("keeps every row when the search is empty", () => {
    expect(matchesQuery("", "Ada Lovelace", "ada@example.com")).toBe(true);
  });

  it("matches on any of the fields it is handed", () => {
    expect(matchesQuery("lovelace", "Ada Lovelace", "ada@example.com")).toBe(true);
    expect(matchesQuery("ada@", "Ada Lovelace", "ada@example.com")).toBe(true);
  });

  it("ignores case in the haystack — the needle arrives lowercased", () => {
    expect(matchesQuery("ada", "ADA LOVELACE")).toBe(true);
  });

  it("drops rows nothing matches", () => {
    expect(matchesQuery("grace", "Ada Lovelace", "ada@example.com")).toBe(false);
  });

  it("matches an invitation on its email alone", () => {
    expect(matchesQuery("invited", "invited@example.com")).toBe(true);
  });
});
