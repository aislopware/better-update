#!/usr/bin/env bun
/**
 * Generate the Kysely `Database` interface (`src/db/schema.d.ts`) by introspecting
 * the local D1 SQLite file that wrangler writes under `.wrangler/state`.
 *
 * The DB schema is the single source of truth: this regenerates the typed table
 * map from the applied migrations. Run `bun run d1:migrate` first so the local
 * DB reflects every migration, then `bun run db:codegen`.
 *
 * Uses the `bun-sqlite` dialect so codegen needs no native `better-sqlite3`
 * build — it reads the file via Bun's built-in `bun:sqlite`.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { Glob } from "bun";

const serverRoot = resolve(import.meta.dir, "..");
const d1StateDir = resolve(serverRoot, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");

const dataFiles = [...new Glob("*.sqlite").scanSync(d1StateDir)].filter(
  (file) => file !== "metadata.sqlite",
);

if (dataFiles.length === 0) {
  console.error(
    `No local D1 SQLite file found in ${d1StateDir}.\n` +
      "Apply migrations first: `bun run d1:migrate`.",
  );
  process.exit(1);
}

if (dataFiles.length > 1) {
  console.warn(`Multiple D1 SQLite files found, using the first: ${dataFiles.join(", ")}`);
}

const databaseUrl = resolve(d1StateDir, dataFiles[0]);

const result = spawnSync(
  "bunx",
  [
    // `--bun` forces the CLI to run under Bun's runtime so the
    // `kysely-bun-sqlite` dialect can use the built-in `bun:sqlite` driver
    // (no native `better-sqlite3` build needed).
    "--bun",
    "kysely-codegen",
    "--dialect",
    "kysely-bun-sqlite",
    "--url",
    databaseUrl,
    // Write the GENERATED file only. `src/db/schema.ts` is a hand-maintained
    // type overlay that re-exports these table interfaces with enum/CHECK
    // columns narrowed to their domain unions — never regenerate over it.
    "--out-file",
    "src/db/schema.generated.d.ts",
    // Keep snake_case column names so generated types line up with the raw DB
    // shape; repositories map snake_case rows → camelCase models explicitly.
    "--camel-case=false",
    // Drop D1 bookkeeping + the FTS5 shadow tables (the `*_fts` virtual tables
    // themselves are kept for typed MATCH queries; their internal shadow tables
    // are noise).
    "--exclude-pattern",
    "(d1_migrations|_cf_*|*_fts_data|*_fts_idx|*_fts_docsize|*_fts_config|*_fts_content)",
  ],
  { stdio: "inherit", cwd: serverRoot },
);

process.exit(result.status ?? 1);
