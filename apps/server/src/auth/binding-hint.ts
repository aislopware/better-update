import type { CredentialBindingType } from "../models";

/**
 * One-line remediation appended to binding-gate 403s: names the exact
 * resource and the CLI command an org admin runs to fix it. Without a known
 * target project the placeholder keeps the command copy-pasteable.
 */
export const bindingHint = (
  resourceType: CredentialBindingType,
  resourceId: string,
  projectId?: string,
): string =>
  `an org admin can bind it: \`better-update credentials bindings add ${resourceType} ${resourceId} --project ${projectId ?? "<project-id>"}\``;
