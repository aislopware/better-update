import { Kysely } from "kysely";

import { makeD1Dialect } from "../cloudflare/d1-dialect";
import { envVarListWhere } from "./env-vars-sql";

import type { DB } from "../db/schema";
import type { EnvVarListFilters } from "./env-vars-sql";

// Compile-only Kysely: the SQLite compiler renders the statement, and the driver
// is never invoked (we only call `.compile()`), so the stub binding is inert.
const db = new Kysely<DB>({ dialect: makeD1Dialect({ database: {} as never }) });

const compileSearch = (search: string) =>
  db
    .selectFrom("env_vars")
    .select("env_vars.id")
    .where((eb) =>
      envVarListWhere(eb, { organizationId: "org", scope: "all", search } as EnvVarListFilters),
    )
    .compile();

describe(envVarListWhere, () => {
  it("renders a short search term as a case-insensitive LIKE substring match", () => {
    const compiled = compileSearch("api");
    expect(compiled.sql).toContain(`"env_vars"."key" LIKE ? ESCAPE '\\'`);
    expect(compiled.parameters).toContain("%API%");
  });

  it("escapes LIKE wildcards in the bound pattern so underscores match literally", () => {
    const compiled = compileSearch("MY_KEY");
    expect(compiled.parameters).toContain(String.raw`%MY\_KEY%`);
  });

  // A long, underscore-dense key inflates the escaped `%…%` pattern past D1's
  // 50-char LIKE ceiling; D1 would reject it (a bare 500), so the builder falls
  // back to an exact key match instead. Regression guard for BU-19.
  it("matches the key exactly when the escaped pattern would exceed D1's LIKE ceiling", () => {
    const key = "EXPO_PUBLIC_STOREFRONT_PERSISTENT_KEY_ENCRYPTION";
    const compiled = compileSearch(key);
    expect(compiled.sql).toContain('"env_vars"."key" = ?');
    expect(compiled.sql).not.toContain("LIKE");
    expect(compiled.parameters).toContain(key);
  });

  it("keeps LIKE right up to the ceiling and switches to equality one char past it", () => {
    // 48 raw chars → `%…%` is exactly 50 (the ceiling) → still LIKE.
    expect(compileSearch("A".repeat(48)).sql).toContain("LIKE ?");
    // 49 raw chars → pattern is 51 → exact match.
    expect(compileSearch("A".repeat(49)).sql).toContain('"env_vars"."key" = ?');
  });
});
