// Built-in "managed" policies are seeded by the server with ids prefixed
// `managed:` (see apps/server/src/auth/managed-policies.ts). The only one is
// `managed:admin` — read-only in the dashboard: viewable, but not editable or
// deletable. Everything finer-grained is a custom policy.
export const isManagedPolicy = (policyId: string): boolean => policyId.startsWith("managed:");

export const ADMIN_POLICY_ID = "managed:admin";
