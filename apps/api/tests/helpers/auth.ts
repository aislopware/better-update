import { permissions } from "../../src/auth/permissions";

import type { AuthContextShape } from "../../src/auth/context";

export const makeAuthContext = (overrides?: Partial<AuthContextShape>): AuthContextShape => ({
  userId: "test-user-id",
  organizationId: "test-org-id",
  role: "owner",
  effectivePermissions: permissions.owner,
  source: "session",
  ...overrides,
});
