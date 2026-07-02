import type { PolicyEffectValue } from "@better-update/api-client/react";

/**
 * UI vocabulary for the policy builder: the resource/action surface mirrors the
 * server `Resource` / `Action` unions (`@better-update/api` auth/context). These
 * are TypeScript-only type unions on the server, so the runtime list is mirrored
 * here for the builder's action chips. The server still re-validates every token
 * against its authoritative vocabulary at write time — this list is convenience
 * only, not a security boundary.
 */
interface ResourceVocabularyEntry {
  readonly resource: string;
  readonly label: string;
  readonly actions: readonly string[];
}

const CRUD = ["read", "create", "update", "delete"] as const;
const READ_WRITE = ["read", "create", "update"] as const;

export const RESOURCE_VOCABULARY: readonly ResourceVocabularyEntry[] = [
  { resource: "organization", label: "Organization", actions: ["read", "update", "delete"] },
  { resource: "member", label: "Members", actions: CRUD },
  { resource: "invitation", label: "Invitations", actions: ["read", "create", "cancel"] },
  { resource: "policy", label: "Policies (IAM)", actions: CRUD },
  { resource: "group", label: "Groups (IAM)", actions: CRUD },
  { resource: "project", label: "Projects", actions: CRUD },
  { resource: "channel", label: "Channels", actions: CRUD },
  { resource: "branch", label: "Branches", actions: CRUD },
  { resource: "update", label: "Updates", actions: ["read", "create", "delete"] },
  { resource: "rollout", label: "Rollouts", actions: CRUD },
  { resource: "billing", label: "Billing", actions: ["read", "update"] },
  { resource: "robotAccount", label: "Robot accounts", actions: CRUD },
  { resource: "build", label: "Builds", actions: ["read", "create", "delete"] },
  { resource: "envVar", label: "Environment variables", actions: CRUD },
  { resource: "auditLog", label: "Audit log", actions: ["read"] },
  { resource: "device", label: "Devices", actions: CRUD },
  { resource: "webhook", label: "Webhooks", actions: CRUD },
  {
    resource: "appleCredential",
    label: "Apple credentials",
    actions: ["read", "create", "update", "delete", "download"],
  },
  {
    resource: "androidCredential",
    label: "Android credentials",
    actions: ["read", "create", "update", "delete", "download"],
  },
  { resource: "iosBundleConfiguration", label: "iOS bundle config", actions: READ_WRITE },
  { resource: "iosAppMetadata", label: "iOS app metadata", actions: READ_WRITE },
  {
    resource: "submission",
    label: "Submissions",
    actions: ["read", "create", "delete"],
  },
  { resource: "vaultAccess", label: "Vault access", actions: ["read", "create", "delete"] },
];

export const EFFECT_OPTIONS: readonly {
  readonly value: PolicyEffectValue;
  readonly label: string;
}[] = [
  { value: "allow", label: "Allow" },
  { value: "deny", label: "Deny" },
];

/**
 * Common selector presets to seed a statement's resource list. The user can edit
 * the inserted value (e.g. fill in concrete ids) before saving.
 */
export const SELECTOR_PRESETS: readonly { readonly label: string; readonly value: string }[] = [
  { label: "Everything (*)", value: "*" },
  { label: "A project", value: "project/{projectId}" },
  { label: "A channel", value: "project/{projectId}/channel/{channelId}" },
  { label: "An environment", value: "project/{projectId}/env/{environment}" },
  {
    label: "An env var",
    value: "project/{projectId}/env/{environment}/envVar/{key}",
  },
];
