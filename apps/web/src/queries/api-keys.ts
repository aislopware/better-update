// API keys are now served by the IAM-gated ManagementApi endpoints (POST/GET/DELETE
// /api/api-keys), not the better-auth apiKey plugin route. The typed query/mutation
// helpers live in the api-client; re-exported here so existing route imports keep
// their path.
export { apiKeysQueryKey, apiKeysQueryOptions } from "@better-update/api-client/react";
export type { ApiKeyItem } from "@better-update/api-client/react";
