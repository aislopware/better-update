import { Deferred, Effect } from "effect";

interface BunServeServer {
  readonly port: number;
  readonly stop: (closeActiveConnections?: boolean) => void;
}

interface BunRuntime {
  readonly serve: (options: {
    readonly hostname: string;
    readonly port: number;
    readonly fetch: (request: Request) => Promise<Response>;
    readonly error: () => Response;
  }) => BunServeServer;
}

export const CALLBACK_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>better-update CLI Login</title>
    <style>
      :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
      main { max-width: 32rem; line-height: 1.5; }
      code { font-family: ui-monospace, SFMono-Regular, monospace; }
    </style>
  </head>
  <body>
    <main>
      <h1>Completing CLI login...</h1>
      <p id="message">Finalizing the local session. You can keep this tab open.</p>
    </main>
    <script>
      const message = document.getElementById("message");
      const render = (text) => {
        if (message) message.textContent = text;
      };

      const params = new URLSearchParams(window.location.hash.slice(1));
      const token = params.get("token");

      if (!token) {
        render("Missing token. Return to the CLI and run login again.");
      } else {
        fetch("/callback/token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        })
          .then(async (response) => {
            if (!response.ok) {
              const body = await response.text();
              throw new Error(body || "Callback failed");
            }
            window.history.replaceState({}, document.title, window.location.pathname);
            render("CLI login complete. You can close this tab.");
            setTimeout(() => window.close(), 300);
          })
          .catch((error) => {
            render(error instanceof Error ? error.message : "Callback failed.");
          });
      }
    </script>
  </body>
</html>`;

export interface BrowserLoginServer {
  readonly callbackUrl: string;
  readonly waitForToken: Effect.Effect<string, Error>;
  readonly stop: () => void;
}

export interface BrowserLoginSession {
  readonly callbackPath: string;
  readonly waitForToken: Effect.Effect<string, Error>;
  readonly handleRequest: (request: Request) => Promise<Response>;
  readonly dispose: () => void;
}

export interface CreateBrowserLoginServerOptions {
  readonly timeoutMs?: number;
}

export const createBrowserLoginSession = (
  options: CreateBrowserLoginServerOptions = {},
): BrowserLoginSession => {
  const tokenDeferred = Effect.runSync(Deferred.make<string, Error>());
  const waitForToken = Deferred.await(tokenDeferred).pipe(
    Effect.timeoutFail({
      duration: options.timeoutMs ?? 5 * 60 * 1000,
      onTimeout: () => new Error("Timed out waiting for browser login to complete."),
    }),
  );

  const dispose = () => {
    Effect.runSync(Deferred.fail(tokenDeferred, new Error("Browser login session closed.")));
  };

  return {
    callbackPath: "/callback",
    waitForToken,
    handleRequest: async (request) => {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/callback") {
        return new Response(CALLBACK_PAGE, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      if (request.method === "POST" && url.pathname === "/callback/token") {
        try {
          const body = (await request.json()) as Record<string, unknown>;
          const token = typeof body["token"] === "string" ? body["token"].trim() : "";
          if (token.length === 0) {
            return new Response("Missing token", { status: 400 });
          }

          Effect.runSync(Deferred.succeed(tokenDeferred, token));
          return Response.json({ ok: true });
        } catch {
          return new Response("Invalid callback payload", { status: 400 });
        }
      }

      return new Response("Not found", { status: 404 });
    },
    dispose,
  };
};

export const createBrowserLoginServer = (
  options: CreateBrowserLoginServerOptions = {},
): BrowserLoginServer => {
  const bunRuntime = (globalThis as typeof globalThis & { readonly Bun?: BunRuntime }).Bun;
  if (!bunRuntime) {
    throw new Error("Browser login server requires the Bun runtime.");
  }

  const session = createBrowserLoginSession(options);
  const server = bunRuntime.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: session.handleRequest,
    error: () => new Response("Local callback failed", { status: 500 }),
  });

  return {
    callbackUrl: `http://127.0.0.1:${server.port}${session.callbackPath}`,
    waitForToken: session.waitForToken,
    stop: () => {
      session.dispose();
      server.stop(true);
    },
  };
};
