import { Effect, Exit } from "effect";

import { parseSubmitProfile, resolveEasSubmitProfile } from "./eas-submit-config";

describe(parseSubmitProfile, () => {
  it("parses an iOS submit profile with all fields", () => {
    const profile = parseSubmitProfile({
      ios: {
        appleId: "owner@example.com",
        ascAppId: "1234567890",
        appleTeamId: "ABCDE12345",
        ascApiKeyPath: "./AuthKey_ABC123.p8",
        ascApiKeyId: "ABC123XYZ0",
        ascApiKeyIssuerId: "12345678-1234-1234-1234-123456789012",
        sku: "MYAPP-001",
        language: "en-US",
        companyName: "Acme Inc",
        appName: "My App",
        bundleIdentifier: "com.example.app",
        metadataPath: "./store.config.json",
        groups: ["internal-testers", "beta"],
      },
    });
    expect(profile?.ios?.appleId).toBe("owner@example.com");
    expect(profile?.ios?.bundleIdentifier).toBe("com.example.app");
    expect(profile?.ios?.groups).toStrictEqual(["internal-testers", "beta"]);
  });

  it("parses an Android submit profile with track + rollout", () => {
    const profile = parseSubmitProfile({
      android: {
        serviceAccountKeyPath: "./pc-api-key.json",
        track: "production",
        releaseStatus: "inProgress",
        changesNotSentForReview: false,
        rollout: 0.1,
        applicationId: "com.example.app",
      },
    });
    expect(profile?.android?.track).toBe("production");
    expect(profile?.android?.releaseStatus).toBe("inProgress");
    expect(profile?.android?.rollout).toBe(0.1);
  });

  it("skips unknown / invalid releaseStatus", () => {
    const profile = parseSubmitProfile({
      android: { applicationId: "com.example.app", releaseStatus: "weird" },
    });
    expect(profile?.android?.applicationId).toBe("com.example.app");
    expect(profile?.android?.releaseStatus).toBeUndefined();
  });

  it("returns undefined for non-object input", () => {
    expect(parseSubmitProfile("not an object")).toBeUndefined();
    expect(parseSubmitProfile(null)).toBeUndefined();
  });
});

describe(resolveEasSubmitProfile, () => {
  it("resolves a single profile without extends", async () => {
    const result = await Effect.runPromiseExit(
      resolveEasSubmitProfile(
        {
          production: { ios: { bundleIdentifier: "com.example.app" } },
        },
        "production",
      ),
    );
    expect(Exit.isSuccess(result)).toBe(true);
    if (Exit.isSuccess(result)) {
      expect(result.value.ios?.bundleIdentifier).toBe("com.example.app");
    }
  });

  it("merges extends chain (overlay wins)", async () => {
    const result = await Effect.runPromiseExit(
      resolveEasSubmitProfile(
        {
          base: {
            ios: { bundleIdentifier: "com.example.app", sku: "BASE" },
            android: { applicationId: "com.example.app", track: "internal" },
          },
          production: {
            extends: "base",
            ios: { sku: "PROD" },
            android: { track: "production" },
          },
        },
        "production",
      ),
    );
    expect(Exit.isSuccess(result)).toBe(true);
    if (Exit.isSuccess(result)) {
      expect(result.value.ios?.bundleIdentifier).toBe("com.example.app");
      expect(result.value.ios?.sku).toBe("PROD");
      expect(result.value.android?.track).toBe("production");
    }
  });

  it("fails when profile not found", async () => {
    const result = await Effect.runPromiseExit(resolveEasSubmitProfile({ base: {} }, "missing"));
    expect(Exit.isFailure(result)).toBe(true);
  });

  it("fails when extends chain cycles", async () => {
    const result = await Effect.runPromiseExit(
      resolveEasSubmitProfile(
        {
          alpha: { extends: "beta" },
          beta: { extends: "alpha" },
        },
        "alpha",
      ),
    );
    expect(Exit.isFailure(result)).toBe(true);
  });

  it("fails when no submit profiles provided", async () => {
    const result = await Effect.runPromiseExit(resolveEasSubmitProfile(undefined, "production"));
    expect(Exit.isFailure(result)).toBe(true);
  });
});
