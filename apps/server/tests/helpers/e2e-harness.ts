/* eslint-disable node/no-process-env -- `process.env` IS this module's contract: wrangler's
   harness reads CLOUDFLARE_* from it, and the vitest globalSetup → test-worker handoff of the
   booted stack's URLs goes through it (see ./e2e-harness-client for why). */
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import path from "node:path";

import { parseDotenvContent } from "@better-update/dotenv";
import { createTestHarness, unstable_splitSqlQuery } from "wrangler";

import { createServerE2EEnvironment } from "./e2e-env";
import { E2E_BASE_URL_ENV, E2E_CONTROL_URL_ENV } from "./e2e-harness-client";

/**
 * Boots the real server Worker for the out-of-process e2e suites (`apps/cli`,
 * `apps/web`) on wrangler's `createTestHarness`, the supported replacement for
 * the deprecated `unstable_startWorker`.
 *
 * The harness runs the production build output in workerd behind a real TCP
 * listener, so an external process — the CLI binary under test, the vite dev
 * proxy, chromium — can talk to it over plain HTTP. Server-side suites do NOT
 * belong here: `tests/integration` and `tests/e2e` run *inside* workerd on
 * `@cloudflare/vitest-pool-workers` and import `src/**` directly, which a
 * black-box harness cannot express.
 */

const SERVER_DIR = path.resolve(import.meta.dirname, "../..");
const WRANGLER_CONFIG = path.join(SERVER_DIR, "wrangler.jsonc");

/**
 * The harness auto-loads `.env` / `.env.local` from the config directory and
 * those values WIN over the config's `vars` (`getVarsForDev` layers them on top
 * as `secret_text`). A developer's `.env` therefore silently overrode
 * `BETTER_AUTH_URL` with their own dev domain, which made better-auth reject
 * every Origin the suite sends as `INVALID_ORIGIN`. `TestHarnessOptions` has no
 * `envFiles` escape hatch the way `unstable_startWorker` did, but wrangler
 * still honours this variable — and reads it lazily, so setting it before
 * `listen()` is enough.
 */
process.env["CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV"] = "false";

/** Minimal structural view of the D1 binding, so this helper stays importable
 * from `apps/cli` / `apps/web` without dragging in the server's global `Env`. */
interface D1Like {
  readonly prepare: (query: string) => unknown;
  readonly batch: (statements: readonly unknown[]) => Promise<unknown>;
}

export interface ServerE2EStack {
  /** Worker origin, e.g. `http://127.0.0.1:53211` (no trailing slash). */
  readonly baseUrl: string;
  /** Origin of the seed control plane — see {@link seedServerE2ESql}. */
  readonly controlUrl: string;
  readonly stop: () => Promise<void>;
}

export interface StartServerE2EStackOptions {
  /**
   * Origin better-auth should treat as canonical (its `baseURL`, and therefore
   * the only trusted Origin). Defaults to the Worker's own origin, which is what
   * the CLI suite wants; the web suite passes the vite dev-server origin because
   * that is where its requests come from.
   */
  readonly webUrl?: string;
  /**
   * Keep the R2 buckets' `remote: true` so the Worker's bindings proxy to the
   * real `*-e2e` buckets. Required by any flow that PUTs to a presigned
   * `*.r2.cloudflarestorage.com` URL and then has the Worker read the object
   * back (asset publish, build upload): the upload lands in real R2, so a local
   * miniflare binding would never see it. Ignored when the `E2E_*` Cloudflare
   * credentials are absent — the stack then boots local-only and R2-dependent
   * flows fail, which is better than refusing to boot at all.
   */
  readonly remoteR2?: boolean;
}

/**
 * The generated `wrangler.jsonc` is a `//` banner followed by plain
 * `JSON.stringify` output (see `scripts/gen-config.ts`), so slicing from the
 * first brace is a complete parse — no jsonc dependency needed.
 */
const readGeneratedWranglerConfig = (): Record<string, unknown> => {
  const raw = (() => {
    try {
      return readFileSync(WRANGLER_CONFIG, "utf8");
    } catch {
      throw new Error(
        `Missing ${WRANGLER_CONFIG}. It is generated and git-ignored — run \`bun run config:gen\` first.`,
      );
    }
  })();
  return JSON.parse(raw.slice(raw.indexOf("{"))) as Record<string, unknown>;
};

interface R2BucketConfig {
  readonly remote?: boolean;
}

/**
 * `routes` is dropped because the harness dispatches by route pattern and the
 * production hostnames are meaningless against a loopback port. `remote: true`
 * is dropped only when the caller has no use for real R2 (or has no credentials
 * for it): any remote binding makes the harness open a proxy session against
 * the real Cloudflare account, and `listen()` hard-fails when that is refused.
 */
const toWorkerConfig = (
  raw: Record<string, unknown>,
  vars: Record<string, string>,
  remoteR2: boolean,
): Record<string, unknown> => {
  // `$schema`, `routes` and `route` are dropped: the harness serves on its own
  // listener, so deploy-time routing keys would make workerd reject the config.
  const { $schema: _schema, routes: _routes, route: _route, ...rest } = raw;
  const buckets = (raw["r2_buckets"] ?? []) as readonly R2BucketConfig[];
  return {
    ...rest,
    r2_buckets: remoteR2 ? buckets : buckets.map(({ remote: _remote, ...bucket }) => bucket),
    vars: { ...(raw["vars"] as Record<string, unknown> | undefined), ...vars },
  };
};

/**
 * The remote-binding proxy is a child process that reads `CLOUDFLARE_*` from the
 * environment it inherits at spawn time, so these must be in `process.env`
 * before `listen()`. Mirrors `apps/server/scripts/e2e-r2.sh` for the
 * `e2e-pool-r2` project. Returns false when the credentials are missing, which
 * is the signal to boot local-only.
 */
const hydrateRemoteR2Credentials = (): boolean => {
  const envLocal = path.join(SERVER_DIR, ".env.local");
  const fileSource = existsSync(envLocal) ? parseDotenvContent(readFileSync(envLocal, "utf8")) : {};

  const resolve = (processKey: string, fileKey: string) =>
    process.env[processKey] ?? (fileSource[fileKey] || undefined);

  const accountId = resolve("CLOUDFLARE_ACCOUNT_ID", "E2E_CF_ACCOUNT_ID");
  const apiToken = resolve("CLOUDFLARE_API_TOKEN", "E2E_CLOUDFLARE_API_TOKEN");
  if (!accountId || !apiToken) {
    return false;
  }

  process.env["CLOUDFLARE_ACCOUNT_ID"] = accountId;
  process.env.CLOUDFLARE_API_TOKEN = apiToken;
  return true;
};

const readRequestBody = async (request: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    request.setEncoding("utf8");
    let body = "";
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      resolve(body);
    });
    request.on("error", reject);
  });

/**
 * The harness keeps storage in-memory (`persist: false` is hardcoded), so the
 * old `bunx wrangler d1 execute --persist-to` seeding — one subprocess per seed,
 * from a different OS process than the Worker — can no longer reach the
 * database. Expose the binding over a loopback control plane instead: the test
 * worker processes POST SQL here and it runs in-process against the live D1.
 */
const startSeedControlPlane = async (database: () => Promise<D1Like>) => {
  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/sql") {
      response.writeHead(404).end();
      return;
    }

    // eslint-disable-next-line eslint/no-void -- fire-and-forget: the node http handler is sync
    void readRequestBody(request)
      .then(async (sql) => {
        const db = await database();
        const statements = unstable_splitSqlQuery(sql).filter((part) => part.trim().length > 0);
        await db.batch(statements.map((statement) => db.prepare(statement)));
        response.writeHead(204).end();
      })
      .catch((error: unknown) => {
        response
          .writeHead(500, { "content-type": "text/plain" })
          .end(error instanceof Error ? error.message : String(error));
      });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Seed control plane failed to bind a port");
  }

  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    close: async () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
};

export const startServerE2EStack = async (
  options: StartServerE2EStackOptions = {},
): Promise<ServerE2EStack> => {
  const raw = readGeneratedWranglerConfig();
  const remoteR2 = (options.remoteR2 ?? false) && hydrateRemoteR2Credentials();
  if (options.remoteR2 && !remoteR2) {
    process.stderr.write(
      "[e2e-harness] No E2E_CF_ACCOUNT_ID / E2E_CLOUDFLARE_API_TOKEN in apps/server/.env.local — " +
        "booting with LOCAL R2. Flows that upload to a presigned R2 URL will fail.\n",
    );
  }

  // Two phases, because the harness always binds an ephemeral port
  // (`server: { port: 0 }` is hardcoded) so the Worker's own origin is unknown
  // until it is listening — yet `BETTER_AUTH_URL` / `PUBLIC_API_URL` must carry
  // it. `update()` reloads the Worker in place: the listening port and the D1
  // contents both survive, which `reset()` would not do.
  const bootstrap = createServerE2EEnvironment({ projectRoot: SERVER_DIR });

  const listen = async (withRemoteR2: boolean) => {
    const server = createTestHarness({
      root: SERVER_DIR,
      workers: [{ config: toWorkerConfig(raw, bootstrap.vars, withRemoteR2) }],
    });
    const started = await server.listen().catch(async (error: unknown) => {
      // `unstable_startWorker` used to fail this silently — it resolved a URL
      // that nothing was listening on, and every request then hung. Surface the
      // runtime timeline instead of leaving the suite to time out.
      server.debug();
      await server.close();
      throw error;
    });
    return { server, started, effectiveRemoteR2: withRemoteR2 };
  };

  // A refused remote-proxy session (expired token, deleted bucket) must not take
  // the whole suite down: fall back to local R2 so every non-R2 flow still runs.
  const { server, started, effectiveRemoteR2 } = await listen(remoteR2).catch(
    async (error: unknown) => {
      if (!remoteR2) {
        throw error;
      }
      process.stderr.write(
        `[e2e-harness] Remote R2 proxy failed (${error instanceof Error ? error.message : String(error)}).\n` +
          "[e2e-harness] Retrying with LOCAL R2 — flows that upload to a presigned R2 URL will fail.\n",
      );
      return listen(false);
    },
  );

  const baseUrl = started.url.href.replace(/\/$/u, "").replace("localhost", "127.0.0.1");

  const resolved = createServerE2EEnvironment({
    projectRoot: SERVER_DIR,
    publicApiUrl: baseUrl,
    webUrl: options.webUrl ?? baseUrl,
  });
  await server.update({
    root: SERVER_DIR,
    workers: [{ config: toWorkerConfig(raw, resolved.vars, effectiveRemoteR2) }],
  });

  const worker = server.getWorker();
  await worker.applyD1Migrations("DB");

  const control = await startSeedControlPlane(async () => {
    const env = await worker.getEnv();
    return env["DB"] as D1Like;
  });

  // Published on `process.env` rather than a JSON file: vitest forks each
  // project's test workers with a snapshot of `process.env` taken *after*
  // globalSetup resolves, so every test file sees these. See `e2e-harness-client`.
  process.env[E2E_BASE_URL_ENV] = baseUrl;
  process.env[E2E_CONTROL_URL_ENV] = control.url;

  return {
    baseUrl,
    controlUrl: control.url,
    stop: async () => {
      await control.close();
      await server.close();
    },
  };
};
