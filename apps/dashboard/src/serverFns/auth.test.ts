import type { SessionResponse } from "./auth";

// Test the SessionResponse type shape matches what Better Auth returns
describe("session response type", () => {
  test("represents valid session data", () => {
    const response: SessionResponse = {
      user: {
        id: "user-1",
        name: "Test User",
        email: "test@example.com",
        image: null,
        emailVerified: true,
        activeOrganizationId: "org-1",
      },
      session: {
        id: "session-1",
        token: "token-abc",
        expiresAt: "2026-12-31T00:00:00Z",
      },
    };

    expect(response.user.id).toBe("user-1");
    expect(response.user.activeOrganizationId).toBe("org-1");
    expect(response.session.token).toBe("token-abc");
  });

  test("allows null image and activeOrganizationId", () => {
    const response: SessionResponse = {
      user: {
        id: "user-2",
        name: "No Org User",
        email: "no-org@example.com",
        image: null,
        emailVerified: false,
        activeOrganizationId: null,
      },
      session: {
        id: "session-2",
        token: "token-xyz",
        expiresAt: "2026-12-31T00:00:00Z",
      },
    };

    expect(response.user.image).toBeNull();
    expect(response.user.activeOrganizationId).toBeNull();
  });
});
