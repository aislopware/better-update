import { generateScopeKey, generateSlug } from "./form-utils";

describe(generateSlug, () => {
  test("converts name to slug", () => {
    expect(generateSlug("Acme Inc.")).toBe("acme-inc");
  });

  test("handles multiple spaces", () => {
    expect(generateSlug("My   Org   Name")).toBe("my-org-name");
  });

  test("strips leading and trailing hyphens", () => {
    expect(generateSlug("  hello world  ")).toBe("hello-world");
  });

  test("preserves numbers", () => {
    expect(generateSlug("Team 42")).toBe("team-42");
  });
});

describe(generateScopeKey, () => {
  test("generates scope key from name", () => {
    expect(generateScopeKey("My App")).toBe("@my-app/app");
  });

  test("handles special characters", () => {
    expect(generateScopeKey("Hello World!")).toBe("@hello-world/app");
  });

  test("strips leading/trailing hyphens", () => {
    expect(generateScopeKey("  Test  ")).toBe("@test/app");
  });

  test("preserves numbers", () => {
    expect(generateScopeKey("App 42")).toBe("@app-42/app");
  });
});
