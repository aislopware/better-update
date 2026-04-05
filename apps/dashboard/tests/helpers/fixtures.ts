import type { ApiKeyResponse, OrgResponse, SessionResponse } from "../../src/serverFns/auth";
import type { ProjectItem } from "../../src/serverFns/projects";

export const makeSession = (
  overrides?: Partial<{
    user: Partial<SessionResponse["user"]>;
    session: Partial<SessionResponse["session"]>;
  }>,
): SessionResponse => ({
  user: {
    id: "user-1",
    name: "Test User",
    email: "test@example.com",
    image: null,
    emailVerified: true,
    activeOrganizationId: "org-1",
    ...overrides?.user,
  },
  session: {
    id: "session-1",
    token: "token-abc",
    expiresAt: "2027-01-01T00:00:00Z",
    ...overrides?.session,
  },
});

export const makeOrg = (overrides?: Partial<OrgResponse>): OrgResponse => ({
  id: "org-1",
  name: "Test Org",
  slug: "test-org",
  logo: null,
  createdAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

export const makeProject = (overrides?: Partial<ProjectItem>): ProjectItem => ({
  id: "proj-1",
  organizationId: "org-1",
  name: "My Project",
  scopeKey: "@my-project/app",
  createdAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

export const makeApiKey = (overrides?: Partial<ApiKeyResponse>): ApiKeyResponse => ({
  id: "key-1",
  name: "Test Key",
  start: "bu_abc",
  prefix: "bu_",
  createdAt: "2026-01-01T00:00:00Z",
  expiresAt: null,
  ...overrides,
});

export const makeMember = (
  overrides?: Partial<{
    id: string;
    userId: string;
    role: string;
    createdAt: Date;
    user: { id: string; name: string; email: string; image: string | null };
  }>,
) => ({
  id: "member-1",
  userId: "user-1",
  role: "owner",
  createdAt: new Date("2026-01-01"),
  user: { id: "user-1", name: "Test User", email: "test@example.com", image: null },
  ...overrides,
});

export const makeInvitation = (
  overrides?: Partial<{
    id: string;
    email: string;
    role: string;
    status: string;
    expiresAt: Date;
  }>,
) => ({
  id: "inv-1",
  email: "invited@example.com",
  role: "member",
  status: "pending",
  expiresAt: new Date("2027-01-01"),
  ...overrides,
});
