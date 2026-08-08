import type { SubmissionItem } from "@better-update/api-client/react";

import { readSubmissionDestination } from "./-submissions-columns";

const base = {
  id: "sub-1",
  organizationId: "org-1",
  projectId: "proj-1",
  platform: "ios" as const,
  profileName: "production",
  archiveSource: "build" as const,
  buildId: "build-1",
  archiveUrl: null,
  iosConfig: null,
  androidConfig: null,
  metadataComplete: true,
  buildVersion: "101",
  initiatingUserId: null,
  createdAt: "2026-01-01T00:00:00Z",
} satisfies SubmissionItem;

const iosConfig = {
  appleId: null,
  ascAppId: "1000000001",
  appleTeamId: "AB12CD34E5",
  sku: "EXAMPLE1",
  language: "en-US",
  companyName: null,
  appName: null,
  bundleIdentifier: "com.example.app",
  ascApiKeyId: null,
  groups: [] as readonly string[],
  whatToTest: null,
};

const androidConfig = {
  applicationId: "com.example.app",
  track: "production",
  releaseStatus: "completed" as const,
  changesNotSentForReview: false,
  rollout: null as number | null,
  googleServiceAccountKeyId: null,
};

describe(readSubmissionDestination, () => {
  it("names the testing groups an iOS build was handed to", () => {
    expect(
      readSubmissionDestination({
        ...base,
        iosConfig: { ...iosConfig, groups: ["Internal Testers", "QA"] },
      }),
    ).toStrictEqual({ target: "TestFlight", detail: "Internal Testers, QA", halted: false });
  });

  it("falls back to App Store Connect when no group was named", () => {
    expect(readSubmissionDestination({ ...base, iosConfig })).toStrictEqual({
      target: "App Store Connect",
      detail: null,
      halted: false,
    });
  });

  it("carries the Play track and its rollout share", () => {
    expect(
      readSubmissionDestination({
        ...base,
        platform: "android",
        androidConfig: { ...androidConfig, rollout: 0.25 },
      }),
    ).toStrictEqual({ target: "Play Console", detail: "production · 25% rollout", halted: false });
  });

  it("flags a halted Play release", () => {
    expect(
      readSubmissionDestination({
        ...base,
        platform: "android",
        androidConfig: { ...androidConfig, releaseStatus: "halted" },
      }),
    ).toStrictEqual({ target: "Play Console", detail: "production", halted: true });
  });

  it("has nothing to say when neither config was recorded", () => {
    expect(readSubmissionDestination(base)).toBeNull();
  });
});
