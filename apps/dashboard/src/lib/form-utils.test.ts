import { envVarKeySchema, generateSlug } from "./form-utils";

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

test("envVarKeySchema accepts valid uppercase env keys", () => {
  expect(envVarKeySchema.safeParse("EXPO_PUBLIC_API_URL").success).toBe(true);
});

test("envVarKeySchema rejects invalid env keys", () => {
  expect(envVarKeySchema.safeParse("expoPublicApiUrl").success).toBe(false);
});
