import { setupE2EDashboard } from "../helpers/e2e-dashboard";

const { post, get, parseCookies } = setupE2EDashboard();

describe("aPI proxy contract", () => {
  it("gET /api/auth/ok returns 200", async () => {
    const response = await get("/api/auth/ok");
    expect(response.status).toBe(200);
  });

  it("gET /api/projects without auth returns 401", async () => {
    const response = await get("/api/projects");
    expect(response.status).toBe(401);
  });

  it("pOST /api/auth/sign-up/email creates user with set-cookie", async () => {
    const response = await post("/api/auth/sign-up/email", {
      name: "Proxy User",
      email: "proxy@example.com",
      password: "SecureP@ss123",
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user?.email).toBe("proxy@example.com");
    const cookies = parseCookies(response);
    expect(cookies.length).toBeGreaterThan(0);
  });
});
