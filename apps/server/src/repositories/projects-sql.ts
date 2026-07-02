// SQL predicate + sort builders for the projects list (extracted from
// projects.ts to keep the repository under the max-lines budget). Pure query
// construction — no I/O.

import { sql } from "kysely";

import type { Expression, ExpressionBuilder, SqlBool } from "kysely";

import type { DB } from "../db/schema";
import type { ProjectListStatus, ProjectSortKey } from "./projects";

// FTS5 trigram tokenizer requires 3+ char queries. Wrap in phrase quotes so
// Special chars (-, ", *, etc.) are treated as literal text rather than FTS
// Operators. Doubling embedded quotes is the standard FTS5 escape.
const escapeFtsPhrase = (value: string): string => `"${value.replaceAll('"', '""')}"`;

// Search predicate: FTS5 MATCH (via a correlated EXISTS over `projects_fts`) for
// 3+ char queries, falling back to a LIKE substring scan for shorter queries the
// trigram index can't tokenize. `null` when there is nothing to filter on.
export const searchExpression = (
  eb: ExpressionBuilder<DB, "projects">,
  query: string | undefined,
): Expression<SqlBool> | null => {
  if (query === undefined || query.length === 0) {
    return null;
  }
  if (query.length >= 3) {
    return eb.exists(
      eb
        .selectFrom("projects_fts")
        .select(sql`1`.as("present"))
        .whereRef("projects_fts.project_id", "=", "projects.id")
        .where(sql<SqlBool>`"projects_fts" MATCH ${escapeFtsPhrase(query)}`),
    );
  }
  // Trigram FTS can't index 1-2 char tokens; LIKE keeps short queries usable.
  const pattern = `%${query.toLowerCase()}%`;
  return eb.or([
    eb(eb.fn<string>("lower", ["projects.name"]), "like", pattern),
    eb(eb.fn<string>("lower", ["projects.slug"]), "like", pattern),
  ]);
};

// `"active"` → archived_at IS NULL, `"archived"` → archived_at IS NOT NULL,
// `"all"` → no archival predicate (`null` collapses to "no filter").
const archivedExpression = (
  eb: ExpressionBuilder<DB, "projects">,
  status: ProjectListStatus,
): Expression<SqlBool> | null => {
  if (status === "active") {
    return eb("projects.archived_at", "is", null);
  }
  if (status === "archived") {
    return eb("projects.archived_at", "is not", null);
  }
  return null;
};

export interface ProjectIdFilter {
  readonly mode: "include" | "exclude";
  readonly ids: readonly string[];
}

// Access filter as a single-parameter json_each membership test — immune to the
// D1 bound-parameter ceiling regardless of how many project ids a grant covers.
const idFilterExpression = (filter: ProjectIdFilter | undefined): Expression<SqlBool> | null => {
  if (filter === undefined) {
    return null;
  }
  const ids = JSON.stringify(filter.ids);
  return filter.mode === "include"
    ? sql<SqlBool>`"projects"."id" IN (SELECT "value" FROM json_each(${ids}))`
    : sql<SqlBool>`"projects"."id" NOT IN (SELECT "value" FROM json_each(${ids}))`;
};

export const projectFilter =
  (
    organizationId: string,
    query: string | undefined,
    status: ProjectListStatus,
    idFilter: ProjectIdFilter | undefined,
  ) =>
  (eb: ExpressionBuilder<DB, "projects">): Expression<SqlBool> => {
    const orgFilter = eb("projects.organization_id", "=", organizationId);
    const conditions = [
      orgFilter,
      searchExpression(eb, query),
      archivedExpression(eb, status),
      idFilterExpression(idFilter),
    ];
    return eb.and(conditions.filter((condition) => condition !== null));
  };

// Sort whitelist → ORDER BY expression. `name` is case-insensitive; the count
// keys reference the computed output aliases. The trailing `projects.id` tie-break
// that keeps pagination stable is applied at the call site.
export const sortColumns = {
  name: sql`"projects"."name" collate nocase`,
  lastActivityAt: sql`"projects"."last_activity_at"`,
  createdAt: sql`"projects"."created_at"`,
  branchCount: sql`"branch_count"`,
  channelCount: sql`"channel_count"`,
  updateCount: sql`"update_count"`,
} satisfies Record<ProjectSortKey, unknown>;
