import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import { isRecord } from "@better-update/type-guards";
import { Data, Deferred, Duration, Effect } from "effect";

export class BrowserLoginTimeoutError extends Data.TaggedError("BrowserLoginTimeoutError")<{
  readonly message: string;
}> {}

export class BrowserLoginSessionClosedError extends Data.TaggedError(
  "BrowserLoginSessionClosedError",
)<{
  readonly message: string;
}> {}

export type BrowserLoginError = BrowserLoginSessionClosedError | BrowserLoginTimeoutError;

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
  readonly waitForToken: Effect.Effect<string, BrowserLoginError>;
  readonly stop: () => void;
}

export interface BrowserLoginSession {
  readonly callbackPath: string;
  readonly waitForToken: Effect.Effect<string, BrowserLoginError>;
  readonly handleRequest: (request: Request) => Promise<Response>;
  readonly dispose: () => void;
}

export interface CreateBrowserLoginServerOptions {
  readonly timeoutMs?: number;
}

export const createBrowserLoginSession = (
  options: CreateBrowserLoginServerOptions = {},
): BrowserLoginSession => {
  const tokenDeferred = Effect.runSync(Deferred.make<string, BrowserLoginSessionClosedError>());
  const waitForToken = Deferred.await(tokenDeferred).pipe(
    Effect.timeoutFail({
      duration:
        options.timeoutMs === undefined ? Duration.minutes(5) : Duration.millis(options.timeoutMs),
      onTimeout: () =>
        new BrowserLoginTimeoutError({
          message: "Timed out waiting for browser login to complete.",
        }),
    }),
  );

  const dispose = () => {
    Effect.runSync(
      Deferred.fail(
        tokenDeferred,
        new BrowserLoginSessionClosedError({
          message: "Browser login session closed.",
        }),
      ),
    );
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
          const body: unknown = await request.json();
          if (!isRecord(body)) {
            return new Response("Invalid callback payload", { status: 400 });
          }
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

const readBody = async (req: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

const toFetchRequest = async (req: IncomingMessage, origin: string): Promise<Request> => {
  const url = new URL(req.url ?? "/", origin);
  const method = req.method ?? "GET";
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) {
      // eslint-disable-next-line no-continue -- forEach would require push-style state mutation; continue keeps the filter inline
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(key, entry);
      }
    } else {
      headers.append(key, value);
    }
  }
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    const body = await readBody(req);
    init.body = new Uint8Array(body);
  }
  return new Request(url, init);
};

const writeFetchResponse = async (res: ServerResponse, response: Response): Promise<void> => {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  const body = await response.arrayBuffer();
  res.end(Buffer.from(body));
};

const handleIncoming = async (
  req: IncomingMessage,
  res: ServerResponse,
  session: BrowserLoginSession,
): Promise<void> => {
  try {
    const request = await toFetchRequest(req, "http://127.0.0.1");
    const response = await session.handleRequest(request);
    await writeFetchResponse(res, response);
  } catch {
    res.statusCode = 500;
    res.end("Local callback failed");
  }
};

export const createBrowserLoginServer = (
  options: CreateBrowserLoginServerOptions = {},
): BrowserLoginServer => {
  const session = createBrowserLoginSession(options);
  const server: Server = createServer((req, res) => {
    // eslint-disable-next-line promise/prefer-await-to-then -- node createServer callback is sync; rejections already swallowed inside handleIncoming, so .catch here is a safety net, not a control-flow then()
    handleIncoming(req, res, session).catch(() => undefined);
  });

  server.listen(0, "127.0.0.1");
  const address = server.address();
  const port = address !== null && typeof address === "object" ? address.port : 0;

  return {
    callbackUrl: `http://127.0.0.1:${port}${session.callbackPath}`,
    waitForToken: session.waitForToken,
    stop: () => {
      session.dispose();
      server.close();
    },
  };
};
