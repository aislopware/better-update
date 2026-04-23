import { envVarKeySchema, generateSlug } from "./form-utils";

describe(generateSlug, () => {
  it("converts name to slug", () => {
    expect(generateSlug("Acme Inc.")).toBe("acme-inc");
  });

  it("handles multiple spaces", () => {
    expect(generateSlug("My   Org   Name")).toBe("my-org-name");
  });

  it("strips leading and trailing hyphens", () => {
    expect(generateSlug("  hello world  ")).toBe("hello-world");
  });

  it("preserves numbers", () => {
    expect(generateSlug("Team 42")).toBe("team-42");
  });
});

it("envVarKeySchema accepts valid uppercase env keys", () => {
  expect(envVarKeySchema.safeParse("EXPO_PUBLIC_API_URL").success).toBe(true);
});

it("envVarKeySchema rejects invalid env keys", () => {
  expect(envVarKeySchema.safeParse("expoPublicApiUrl").success).toBe(false);
});
