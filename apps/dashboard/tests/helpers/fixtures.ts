import type { ApiKey } from "@better-auth/api-key/types";
import type { BranchItem, ProjectItem } from "@better-update/api-client/react";

export type ApiKeyResponse = Pick<
  ApiKey,
  "id" | "name" | "start" | "prefix" | "createdAt" | "expiresAt"
>;

export interface SessionResponse {
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
    emailVerified: boolean;
  };
  session: { id: string; token: string; expiresAt: string; activeOrganizationId: string | null };
}

export interface OrgResponse {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  createdAt: string;
}

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
    ...overrides?.user,
  },
  session: {
    id: "session-1",
    token: "token-abc",
    expiresAt: "2027-01-01T00:00:00Z",
    activeOrganizationId: "org-1",
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
  slug: "my-project",
  createdAt: "2026-01-01T00:00:00Z",
  lastActivityAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

export const makeApiKey = (overrides?: Partial<ApiKeyResponse>): ApiKeyResponse => ({
  id: "key-1",
  name: "Test Key",
  start: "bu_abc",
  prefix: "bu_",
  createdAt: new Date("2026-01-01T00:00:00Z"),
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

export const makeBranch = (overrides?: Partial<BranchItem>): BranchItem => ({
  id: "branch-1",
  projectId: "proj-1",
  name: "main",
  createdAt: "2026-01-01T00:00:00Z",
  ...overrides,
});
