import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { get } = setupE2EWorker(".wrangler/state/e2e-health");

describe("Public health endpoint", () => {
  it("returns 200 with status=ok and an ISO timestamp", async () => {
    const response = await get("/api/health");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; timestamp: string };
    expect(body.status).toBe("ok");
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u);
  });

  it("is reachable without authentication", async () => {
    const response = await get("/api/health");
    expect(response.status).toBe(200);
  });
});
