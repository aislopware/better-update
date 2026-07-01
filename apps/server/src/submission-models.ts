import type { Platform } from "./models";

export type SubmissionArchiveSource = "build" | "path" | "url";

export type AndroidReleaseStatus = "completed" | "draft" | "halted" | "inProgress";

export interface IosAppMetadataModel {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly bundleIdentifier: string;
  readonly ascAppId: string | null;
  readonly sku: string | null;
  readonly language: string;
  readonly companyName: string | null;
  readonly appName: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IosSubmissionConfigModel {
  readonly appleId: string | null;
  readonly ascAppId: string | null;
  readonly appleTeamId: string | null;
  readonly sku: string | null;
  readonly language: string;
  readonly companyName: string | null;
  readonly appName: string | null;
  readonly bundleIdentifier: string;
  readonly ascApiKeyId: string | null;
  readonly groups: readonly string[];
  readonly whatToTest: string | null;
}

export interface AndroidSubmissionConfigModel {
  readonly applicationId: string;
  readonly track: string;
  readonly releaseStatus: AndroidReleaseStatus;
  readonly changesNotSentForReview: boolean;
  readonly rollout: number | null;
  readonly googleServiceAccountKeyId: string | null;
}

// Immutable success record — a row exists iff a client-side upload succeeded.
export interface SubmissionModel {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly platform: Platform;
  readonly profileName: string;
  readonly archiveSource: SubmissionArchiveSource;
  readonly buildId: string | null;
  readonly archiveUrl: string | null;
  readonly submissionConfigJson: string;
  readonly initiatingUserId: string | null;
  readonly createdAt: string;
}
