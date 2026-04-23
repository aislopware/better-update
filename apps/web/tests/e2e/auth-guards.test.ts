import { setupE2EDashboard } from "../helpers/e2e-dashboard";

const { post, get, parseCookies } = setupE2EDashboard();

describe("auth guards contract", () => {
  it("unauthenticated GET /api/projects returns 401", async () => {
    const response = await get("/api/projects");
    expect(response.status).toBe(401);
  });

  it("invalid credentials return error", async () => {
    const response = await post("/api/auth/sign-in/email", {
      email: "nonexistent@example.com",
      password: "WrongPassword123",
    });
    expect(response.ok).toBe(false);
  });

  it("valid session can access protected endpoints", async () => {
    const signUpResponse = await post("/api/auth/sign-up/email", {
      name: "Auth Guard User",
      email: "authguard@example.com",
      password: "SecureP@ss123",
    });
    expect(signUpResponse.status).toBe(200);
    const cookies = parseCookies(signUpResponse);

    const createOrgResponse = await post(
      "/api/auth/organization/create",
      { name: "Auth Org", slug: "auth-org" },
      { cookie: cookies },
    );
    expect(createOrgResponse.status).toBe(200);
    const orgBody = await createOrgResponse.json();
    const updatedCookies = parseCookies(createOrgResponse) || cookies;

    const activateResponse = await post(
      "/api/auth/organization/set-active",
      { organizationId: orgBody.id },
      { cookie: updatedCookies },
    );
    expect(activateResponse.status).toBe(200);
    const sessionCookies = parseCookies(activateResponse) || updatedCookies;

    const response = await get("/api/projects", { cookie: sessionCookies });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("items");
  });

  it("sign-in with wrong password fails", async () => {
    await post("/api/auth/sign-up/email", {
      name: "Wrong Pass User",
      email: "wrongpass@example.com",
      password: "CorrectP@ss123",
    });

    const response = await post("/api/auth/sign-in/email", {
      email: "wrongpass@example.com",
      password: "TotallyWrongP@ss456",
    });
    expect(response.ok).toBe(false);
  });
});
