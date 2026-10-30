/**
 * Applies `migrations/*.sql` to the server's D1 database with `cf`, which takes
 * the database by id (the binding name `DB` means nothing to it), so the id is
 * resolved from the deploy config here.
 *
 *   bun scripts/d1-migrate.ts           # local: the state `cf dev` / vite dev use
 *   bun scripts/d1-migrate.ts --remote  # the real database (strict identity)
 *
 * `cf d1 migrations apply` is wire-compatible with Wrangler's: same
 * `d1_migrations` table, same recorded names, so it picks up where a
 * Wrangler-migrated database left off.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

import { loadDeployConfig } from "@better-update/deploy-config";

const SERVER_DIR = path.resolve(import.meta.dirname, "..");
const remote = process.argv.includes("--remote");

const { d1DatabaseId } = loadDeployConfig({ strict: remote });

execFileSync(
  "cf",
  [
    "d1",
    "migrations",
    "apply",
    d1DatabaseId,
    "--dir",
    "migrations",
    // The Cloudflare Vite plugin keeps development data in `.cloudflare/state`;
    // without `--persist-to`, `--local` would write to cf's shared per-user
    // directory instead, which the dev server never reads.
    ...(remote ? [] : ["--local", "--persist-to", ".cloudflare/state"]),
  ],
  { cwd: SERVER_DIR, stdio: "inherit" },
);
