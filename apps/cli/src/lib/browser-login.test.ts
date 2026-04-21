import { Effect } from "effect";

import {
  BrowserLoginSessionClosedError,
  BrowserLoginTimeoutError,
  CALLBACK_PAGE,
  createBrowserLoginSession,
} from "./browser-login";

describe(createBrowserLoginSession, () => {
  it("serves the callback page HTML", async () => {
    const session = createBrowserLoginSession({ timeoutMs: 1000 });

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

  it("resolves the submitted token", async () => {
    const session = createBrowserLoginSession({ timeoutMs: 1000 });

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

  it("rejects invalid callback payloads", async () => {
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
      const error = await Effect.runPromise(Effect.flip(session.waitForToken));
      expect(error).toBeInstanceOf(BrowserLoginTimeoutError);
      expect(error._tag).toBe("BrowserLoginTimeoutError");
    } finally {
      session.dispose();
    }
  });

  it("times out when no token arrives", async () => {
    const session = createBrowserLoginSession({ timeoutMs: 20 });

    try {
      const error = await Effect.runPromise(Effect.flip(session.waitForToken));
      expect(error).toBeInstanceOf(BrowserLoginTimeoutError);
      expect(error._tag).toBe("BrowserLoginTimeoutError");
    } finally {
      session.dispose();
    }
  });

  it("fails with a tagged error when the session is disposed", async () => {
    const session = createBrowserLoginSession({ timeoutMs: 1000 });

    session.dispose();

    const error = await Effect.runPromise(Effect.flip(session.waitForToken));
    expect(error).toBeInstanceOf(BrowserLoginSessionClosedError);
    expect(error._tag).toBe("BrowserLoginSessionClosedError");
  });
});
