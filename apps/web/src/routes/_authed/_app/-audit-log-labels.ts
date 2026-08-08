import { AuditLogResourceType } from "@better-update/api";
import { safeJsonParse } from "@better-update/safe-json";

// Taken from the contract rather than retyped beside it: the audit-log repository
// filters with `WHERE resource_type = ?`, so every option has to equal a stored
// value, and the hand-kept copy had already drifted — `credentialBinding` was
// missing, so binding events printed their raw token and no chip could find them.
export const RESOURCE_TYPE_VALUES = AuditLogResourceType.literals;

export type ResourceTypeValue = (typeof RESOURCE_TYPE_VALUES)[number];

const RESOURCE_TYPE_LABELS: Record<ResourceTypeValue, string> = {
  project: "Project",
  branch: "Branch",
  channel: "Channel",
  update: "Update",
  environment: "Environment",
  build: "Build",
  appleCredential: "Apple credential",
  androidCredential: "Android credential",
  iosBundleConfiguration: "iOS bundle config",
  iosAppMetadata: "iOS app metadata",
  envVar: "Env var",
  device: "Device",
  webhook: "Webhook",
  submission: "Submission",
  vaultAccess: "Vault access",
  policy: "Policy",
  group: "Group",
  policyAttachment: "Policy attachment",
  robotAccount: "Robot account",
  credentialBinding: "Credential binding",
  invitation: "Invitation",
  member: "Member",
  organization: "Organization",
};

export const isResourceType = (value: unknown): value is ResourceTypeValue =>
  (RESOURCE_TYPE_VALUES as readonly unknown[]).includes(value);

// An empty chip selection means "all resources".
export const RESOURCE_FILTER_OPTIONS = RESOURCE_TYPE_VALUES.map((value) => ({
  value,
  label: RESOURCE_TYPE_LABELS[value],
}));

// Split on dots, dashes, underscores and camelCase boundaries, then sentence-case
// the whole token: `apple.push-key.upload` -> "Apple push key upload",
// `envVar.bulkImport` -> "Env var bulk import". Underscores used to survive the
// split, so `projectMember.all_projects_set` reached the table still wearing one.
const humanizeActionToken = (action: string): string => {
  const words = action
    .split(".")
    .flatMap((segment) => segment.split("-"))
    .flatMap((segment) => segment.split("_"))
    .flatMap((segment) =>
      segment.replaceAll(/(?<lower>[a-z0-9])(?<upper>[A-Z])/gu, "$<lower> $<upper>").split(" "),
    )
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  const [first, ...rest] = words;
  if (!first) {
    return action;
  }
  return [`${first.charAt(0).toUpperCase()}${first.slice(1)}`, ...rest].join(" ");
};

// A row stored before its type joined the contract still has to read as English,
// so the fallback goes through the same humanizer the actions use rather than
// printing `credentialBinding` at the reader.
export const resourceTypeLabel = (value: string): string =>
  isResourceType(value) ? RESOURCE_TYPE_LABELS[value] : humanizeActionToken(value);

// Audit `action` strings are raw tokens (`vault.web.unlock`, `apple.push-key.upload`).
// Most humanize cleanly by de-dotting/de-casing, but a few are jargon or historical,
// so this override map wins first. The pre-rename `vault.web.step-up` maps to the same
// label as its `vault.web.unlock` rename, so old rows read identically with no backfill.
const ACTION_LABELS: Record<string, string> = {
  "vault.web.step-up": "Env vault unlocked (passkey)",
  "vault.web.unlock": "Env vault unlocked (passkey)",
  "envVar.describe": "Env var documentation edited",
  // "Project member all projects set" is what the token says and not what it
  // means: these two grant and revoke one role across every project at once.
  "projectMember.all_projects_set": "Member given a role on all projects",
  "projectMember.all_projects_remove": "Member's all-projects role removed",
};

export const actionLabel = (action: string): string =>
  ACTION_LABELS[action] ?? humanizeActionToken(action);

export const parseAuditMetadata = (metadata: string | null): unknown =>
  metadata ? safeJsonParse(metadata) : null;

// Audit metadata is free-form JSON, but most events stamp a human identifier
// under one of a few well-known keys — surface it so a row can say "production"
// rather than only a UUID.
export const readAuditResourceName = (parsed: unknown): string | undefined => {
  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }
  const { name, message, key, email, slug } = parsed as {
    name?: unknown;
    message?: unknown;
    key?: unknown;
    email?: unknown;
    slug?: unknown;
  };
  return [name, message, key, email, slug].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
};
