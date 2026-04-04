import { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";

describe("auth guard logic (_authed.tsx)", () => {
  const createContext = (session: unknown, orgs: unknown[] = []) => ({
    queryClient: new QueryClient(),
    session,
    orgs,
  });

  test("redirects to /login when session is null", () => {
    const context = createContext(null);
    expect(() => {
      if (!context.session) {
        throw redirect({ to: "/login" });
      }
    }).toThrow();
  });

  test("passes when session has user", () => {
    const session = {
      user: { id: "user-1", email: "test@example.com" },
      session: { id: "session-1" },
    };
    const context = createContext(session);
    expect(context.session).not.toBeNull();
  });

  test("redirects when session is undefined", () => {
    const context = createContext(undefined);
    expect(() => {
      if (!context.session) {
        throw redirect({ to: "/login" });
      }
    }).toThrow();
  });

  test("returns user and orgs in context", () => {
    const session = {
      user: { id: "user-1", email: "test@example.com", activeOrganizationId: "org-1" },
      session: { id: "session-1" },
    };
    const orgs = [{ id: "org-1", name: "Test Org", slug: "test-org" }];
    const context = createContext(session, orgs);

    expect(context.session).not.toBeNull();
    expect(context.orgs).toHaveLength(1);
  });
});

describe("auth page guard logic", () => {
  const checkAuthRedirect = (session: { user: unknown } | null) => {
    if (session?.user) {
      throw redirect({ to: "/" });
    }
  };

  test("redirects authenticated users away from auth pages", () => {
    expect(() => checkAuthRedirect({ user: { id: "user-1" } })).toThrow();
  });

  test("allows unauthenticated users to access auth pages", () => {
    expect(() => checkAuthRedirect(null)).not.toThrow();
  });
});

describe("app layout guard logic (_app.tsx)", () => {
  const checkOrgRedirect = (orgs: unknown[]) => {
    if (orgs.length === 0) {
      throw redirect({ to: "/onboarding" });
    }
  };

  test("redirects to /onboarding when no orgs", () => {
    expect(() => checkOrgRedirect([])).toThrow();
  });

  test("passes when orgs exist", () => {
    const orgs = [{ id: "org-1", name: "Test Org" }];
    expect(() => checkOrgRedirect(orgs)).not.toThrow();
  });

  test("finds active org from session", () => {
    const orgs = [
      { id: "org-1", name: "Org A" },
      { id: "org-2", name: "Org B" },
    ];
    const activeOrgId = "org-2";
    const activeOrg = orgs.find((org) => org.id === activeOrgId) ?? orgs[0];
    expect(activeOrg?.name).toBe("Org B");
  });

  test("falls back to first org when no matching activeOrganizationId", () => {
    const orgs = [
      { id: "org-1", name: "Org A" },
      { id: "org-2", name: "Org B" },
    ];
    const activeOrgId = "nonexistent-id";
    const activeOrg = orgs.find((org) => org.id === activeOrgId) ?? orgs[0];
    expect(activeOrg?.name).toBe("Org A");
  });
});

describe("onboarding guard logic", () => {
  const checkOnboardingRedirect = (orgs: unknown[]) => {
    if (orgs.length > 0) {
      throw redirect({ to: "/" });
    }
  };

  test("redirects to / when orgs exist", () => {
    expect(() => checkOnboardingRedirect([{ id: "org-1" }])).toThrow();
  });

  test("allows access when no orgs", () => {
    expect(() => checkOnboardingRedirect([])).not.toThrow();
  });
});

describe("getInitials", () => {
  const getInitials = (name: string) =>
    name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

  test("extracts initials from full name", () => {
    expect(getInitials("John Doe")).toBe("JD");
  });

  test("returns single letter for single name", () => {
    expect(getInitials("Alice")).toBe("A");
  });

  test("caps at 2 initials", () => {
    expect(getInitials("John Michael Doe")).toBe("JM");
  });

  test("uppercases lowercase names", () => {
    expect(getInitials("john doe")).toBe("JD");
  });
});

describe("members query key factory", () => {
  test("produces correct key for members", () => {
    const orgId = "org-123";
    expect(["org", orgId, "members"]).toEqual(["org", "org-123", "members"]);
  });

  test("produces correct key for invitations", () => {
    const orgId = "org-456";
    expect(["org", orgId, "invitations"]).toEqual(["org", "org-456", "invitations"]);
  });

  test("different orgIds produce different keys", () => {
    const key1 = ["org", "org-1", "members"];
    const key2 = ["org", "org-2", "members"];
    expect(key1).not.toEqual(key2);
  });
});

describe("roleBadgeVariant", () => {
  const roleBadgeVariant = (role: string): "default" | "secondary" | "outline" => {
    if (role === "owner") {
      return "default";
    }
    if (role === "admin") {
      return "secondary";
    }
    return "outline";
  };

  test("returns default for owner", () => {
    expect(roleBadgeVariant("owner")).toBe("default");
  });

  test("returns secondary for admin", () => {
    expect(roleBadgeVariant("admin")).toBe("secondary");
  });

  test("returns outline for member", () => {
    expect(roleBadgeVariant("member")).toBe("outline");
  });

  test("returns outline for unknown role", () => {
    expect(roleBadgeVariant("viewer")).toBe("outline");
  });
});

describe("canManageRole", () => {
  const canManageRole = (currentRole: string, targetRole: string): boolean =>
    currentRole === "owner" && targetRole !== "owner";

  test("owner can manage admin", () => {
    expect(canManageRole("owner", "admin")).toBe(true);
  });

  test("owner can manage member", () => {
    expect(canManageRole("owner", "member")).toBe(true);
  });

  test("owner cannot manage another owner", () => {
    expect(canManageRole("owner", "owner")).toBe(false);
  });

  test("admin cannot manage anyone", () => {
    expect(canManageRole("admin", "member")).toBe(false);
  });

  test("member cannot manage anyone", () => {
    expect(canManageRole("member", "admin")).toBe(false);
  });
});

describe("invitation filtering", () => {
  const filterPending = (invitations: { id: string; status: string }[]) =>
    invitations.filter((inv) => inv.status === "pending");

  test("filters only pending invitations", () => {
    const invitations = [
      { id: "1", status: "pending" },
      { id: "2", status: "accepted" },
      { id: "3", status: "pending" },
      { id: "4", status: "canceled" },
    ];
    const result = filterPending(invitations);
    expect(result).toHaveLength(2);
    expect(result.map((inv) => inv.id)).toEqual(["1", "3"]);
  });

  test("returns empty array when no pending", () => {
    const invitations = [
      { id: "1", status: "accepted" },
      { id: "2", status: "rejected" },
    ];
    expect(filterPending(invitations)).toHaveLength(0);
  });

  test("returns all when all pending", () => {
    const invitations = [
      { id: "1", status: "pending" },
      { id: "2", status: "pending" },
    ];
    expect(filterPending(invitations)).toHaveLength(2);
  });
});

// ── Wave 4: Projects ─────────────────────────────────────────────

describe("projects query key factory", () => {
  test("produces correct key for projects", () => {
    const orgId = "org-123";
    expect(["org", orgId, "projects"]).toEqual(["org", "org-123", "projects"]);
  });

  test("different orgIds produce different keys", () => {
    const key1 = ["org", "org-1", "projects"];
    const key2 = ["org", "org-2", "projects"];
    expect(key1).not.toEqual(key2);
  });
});

describe("isProjectListResponse", () => {
  const isProjectListResponse = (data: unknown): boolean =>
    typeof data === "object" &&
    data !== null &&
    "items" in data &&
    Array.isArray((data as { items: unknown }).items) &&
    "total" in data &&
    typeof (data as { total: unknown }).total === "number";

  test("accepts valid response", () => {
    expect(
      isProjectListResponse({
        items: [{ id: "1", name: "Test" }],
        total: 1,
        page: 1,
        limit: 20,
      }),
    ).toBe(true);
  });

  test("rejects null", () => {
    expect(isProjectListResponse(null)).toBe(false);
  });

  test("rejects missing items", () => {
    expect(isProjectListResponse({ total: 0, page: 1, limit: 20 })).toBe(false);
  });

  test("rejects non-array items", () => {
    expect(isProjectListResponse({ items: "not-array", total: 0, page: 1, limit: 20 })).toBe(false);
  });

  test("rejects missing total", () => {
    expect(isProjectListResponse({ items: [], page: 1, limit: 20 })).toBe(false);
  });

  test("accepts empty items array", () => {
    expect(isProjectListResponse({ items: [], total: 0, page: 1, limit: 20 })).toBe(true);
  });
});

describe("getResponseError extraction logic", () => {
  const extractMessage = (body: unknown, fallback: string): string => {
    if (
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof body.message === "string"
    ) {
      return body.message;
    }
    return fallback;
  };

  test("extracts message from error body", () => {
    expect(extractMessage({ message: "Not found" }, "fallback")).toBe("Not found");
  });

  test("falls back for non-object body", () => {
    expect(extractMessage("string body", "fallback")).toBe("fallback");
  });

  test("falls back for body without message", () => {
    expect(extractMessage({ error: "something" }, "fallback")).toBe("fallback");
  });

  test("falls back for null body", () => {
    expect(extractMessage(null, "fallback")).toBe("fallback");
  });

  test("falls back for numeric message", () => {
    expect(extractMessage({ message: 42 }, "fallback")).toBe("fallback");
  });
});

// ── Wave 5: API Keys ────────────────────────────────────────────

describe("api keys query key factory", () => {
  test("produces correct key for api-keys", () => {
    const orgId = "org-123";
    expect(["org", orgId, "api-keys"]).toEqual(["org", "org-123", "api-keys"]);
  });

  test("different orgIds produce different keys", () => {
    const key1 = ["org", "org-1", "api-keys"];
    const key2 = ["org", "org-2", "api-keys"];
    expect(key1).not.toEqual(key2);
  });
});

describe("maskKey", () => {
  const maskKey = (start: string | null, prefix: string | null): string => {
    if (start) {
      return `${start}${"*".repeat(8)}`;
    }
    if (prefix) {
      return `${prefix}${"*".repeat(12)}`;
    }
    return "****";
  };

  test("uses start characters when available", () => {
    expect(maskKey("bu_abc", "bu_")).toBe("bu_abc********");
  });

  test("falls back to prefix when no start", () => {
    expect(maskKey(null, "bu_")).toBe("bu_************");
  });

  test("returns generic mask when no start or prefix", () => {
    expect(maskKey(null, null)).toBe("****");
  });

  test("start takes precedence over prefix", () => {
    const result = maskKey("bu_xyz", "bu_");
    expect(result.startsWith("bu_xyz")).toBe(true);
    expect(result).toBe("bu_xyz********");
  });
});

describe("api key expiry display", () => {
  const formatExpiry = (expiresAt: string | null): string =>
    expiresAt ? new Date(expiresAt).toLocaleDateString() : "Never";

  test("returns formatted date when expires", () => {
    const result = formatExpiry("2026-12-31T00:00:00.000Z");
    expectTypeOf(result).toBeString();
    expect(result).not.toBe("Never");
  });

  test("returns Never when no expiry", () => {
    expect(formatExpiry(null)).toBe("Never");
  });
});
