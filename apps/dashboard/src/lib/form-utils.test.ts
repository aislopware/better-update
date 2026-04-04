import { generateScopeKey, generateSlug, nameSchema, slugSchema } from "./form-utils";

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

describe("nameSchema validation", () => {
  test("rejects strings shorter than 2 characters", () => {
    expect(nameSchema.safeParse("A").success).toBe(false);
  });

  test("rejects empty string", () => {
    expect(nameSchema.safeParse("").success).toBe(false);
  });

  test("accepts strings of 2+ characters", () => {
    expect(nameSchema.safeParse("AB").success).toBe(true);
  });

  test("accepts long names", () => {
    expect(nameSchema.safeParse("My Organization").success).toBe(true);
  });
});

describe("slugSchema validation", () => {
  test("rejects strings shorter than 2 characters", () => {
    expect(slugSchema.safeParse("a").success).toBe(false);
  });

  test("rejects strings longer than 48 characters", () => {
    expect(slugSchema.safeParse("a".repeat(49)).success).toBe(false);
  });

  test("accepts strings at max 48 characters", () => {
    expect(slugSchema.safeParse("a".repeat(48)).success).toBe(true);
  });

  test("rejects strings with uppercase letters", () => {
    expect(slugSchema.safeParse("Acme").success).toBe(false);
  });

  test("rejects strings with special characters", () => {
    expect(slugSchema.safeParse("acme_inc").success).toBe(false);
  });

  test("accepts valid slugs", () => {
    expect(slugSchema.safeParse("acme-inc").success).toBe(true);
  });

  test("accepts slugs with numbers", () => {
    expect(slugSchema.safeParse("team-42").success).toBe(true);
  });
});
