import { Effect } from "effect";

import { CALLBACK_PAGE, createBrowserLoginSession } from "./browser-login";

describe(createBrowserLoginSession, () => {
  test("serves the callback page HTML", async () => {
    const session = createBrowserLoginSession({ timeoutMs: 1_000 });

    try {
      const response = await session.handleRequest(new Request("http://127.0.0.1/callback"));
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(html).toContain("Completing CLI login");
      expect(html).toContain(CALLBACK_PAGE.slice(0, 15));
    } finally {
      session.dispose();
    }
  });

  test("resolves the submitted token", async () => {
    const session = createBrowserLoginSession({ timeoutMs: 1_000 });

    try {
      const response = await session.handleRequest(
        new Request("http://127.0.0.1/callback/token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: "bu_secret_123" }),
        }),
      );

      expect(response.status).toBe(200);
      await expect(Effect.runPromise(session.waitForToken)).resolves.toBe("bu_secret_123");
    } finally {
      session.dispose();
    }
  });

  test("rejects invalid callback payloads", async () => {
    const session = createBrowserLoginSession({ timeoutMs: 50 });

    try {
      const response = await session.handleRequest(
        new Request("http://127.0.0.1/callback/token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: "" }),
        }),
      );

      expect(response.status).toBe(400);
      await expect(Effect.runPromise(session.waitForToken)).rejects.toThrow(
        "Timed out waiting for browser login to complete.",
      );
    } finally {
      session.dispose();
    }
  });

  test("times out when no token arrives", async () => {
    const session = createBrowserLoginSession({ timeoutMs: 20 });

    try {
      await expect(Effect.runPromise(session.waitForToken)).rejects.toThrow(
        "Timed out waiting for browser login to complete.",
      );
    } finally {
      session.dispose();
    }
  });
});
