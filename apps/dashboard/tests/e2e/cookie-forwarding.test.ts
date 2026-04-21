import { setupE2EDashboard } from "../helpers/e2e-dashboard";

const { post, get, parseCookies } = setupE2EDashboard();

describe("cookie-based auth", () => {
  const state = { cookies: "", organizationId: "" };

  it("sign up returns session cookie", async () => {
    const response = await post("/api/auth/sign-up/email", {
      name: "Cookie User",
      email: "cookie@example.com",
      password: "SecureP@ss123",
    });
    expect(response.status).toBe(200);
    state.cookies = parseCookies(response);
    expect(state.cookies.length).toBeGreaterThan(0);
  });

  it("gET /api/auth/get-session with cookie returns session", async () => {
    const response = await get("/api/auth/get-session", { cookie: state.cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.session).toBeDefined();
    expect(body.user?.email).toBe("cookie@example.com");
  });

  it("creates and activates an organization for project access", async () => {
    const createResponse = await post(
      "/api/auth/organization/create",
      { name: "Cookie Org", slug: "cookie-org" },
      { cookie: state.cookies },
    );
    expect(createResponse.status).toBe(200);
    const createBody = await createResponse.json();
    state.organizationId = createBody.id;
    state.cookies = parseCookies(createResponse) || state.cookies;

    const activateResponse = await post(
      "/api/auth/organization/set-active",
      { organizationId: state.organizationId },
      { cookie: state.cookies },
    );
    expect(activateResponse.status).toBe(200);
    state.cookies = parseCookies(activateResponse) || state.cookies;
  });

  it("gET /api/projects with cookie returns 200", async () => {
    const response = await get("/api/projects", { cookie: state.cookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("items");
  });

  it("gET /api/projects without cookie returns 401", async () => {
    const response = await get("/api/projects");
    expect(response.status).toBe(401);
  });
});
