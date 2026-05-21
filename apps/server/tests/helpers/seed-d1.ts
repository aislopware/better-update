import { env } from "cloudflare:test";

/**
 * Drop blank + `--` comment lines from the front of a statement, stopping at the
 * first real SQL line. Only *leading* lines are touched so values that happen to
 * contain `--` (e.g. a `-----BEGIN CERTIFICATE-----` blob) survive intact.
 */
const stripLeadingComments = (fragment: string): string => {
  const lines = fragment.split("\n");
  const start = lines.findIndex((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("--");
  });
  return start === -1 ? "" : lines.slice(start).join("\n").trim();
};

/**
 * Run a multi-statement SQL seed against the pool's local D1.
 *
 * D1's `exec` splits on newlines and rejects multi-line statements, which the
 * seed scripts use freely, so instead split on `;` (the seeds contain no
 * semicolons inside string literals), drop leading-comment / empty fragments,
 * and batch the prepared statements in one transaction. Replaces the old
 * `wrangler d1 execute --persist-to` shell-out, which has no equivalent under
 * vitest-pool-workers (D1 lives in-runtime, not on disk).
 */
export const seedD1 = async (sql: string): Promise<void> => {
  const statements = sql
    .split(";")
    .map(stripLeadingComments)
    .filter((statement) => statement.length > 0)
    .map((statement) => env.DB.prepare(statement));
  if (statements.length > 0) {
    await env.DB.batch(statements);
  }
};
