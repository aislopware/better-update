// Built-in "managed" policies are seeded by the server with ids prefixed
// `managed:` (see apps/server/src/auth/managed-policies.ts). They are read-only
// in the dashboard — viewable, but not editable or deletable.
export const isManagedPolicy = (policyId: string): boolean => policyId.startsWith("managed:");
