/**
 * The TEST-WORKER half of the e2e stack contract.
 *
 * Deliberately free of any `wrangler` / `playwright` import: this module is
 * pulled into all ~27 CLI + web test-worker processes, while the stack itself
 * (`./e2e-harness`) only ever loads in the single globalSetup process. Keep it
 * that way — importing the stack module here would drag wrangler's multi-MB
 * bundle, and its `process.env` mutation, into every worker.
 *
 * The handoff is `process.env`, not a JSON file on disk: vitest snapshots
 * `{ ...process.env }` when it forks each project's workers, and it does so
 * *after* awaiting globalSetup (`runFiles` → `initializeGlobalSetup` → pool),
 * so anything globalSetup exports here is visible to every test file. A file
 * has to be created, found and cleaned up, and a teardown that fires while
 * files are still running takes the whole suite down with `ENOENT`.
 */

export const E2E_BASE_URL_ENV = "BETTER_UPDATE_E2E_BASE_URL";
export const E2E_CONTROL_URL_ENV = "BETTER_UPDATE_E2E_CONTROL_URL";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. The e2e stack publishes it from globalSetup — is this test running outside the e2e project?`,
    );
  }
  return value;
};

/** Origin of the server Worker under test (no trailing slash). */
export const serverE2EBaseUrl = (): string => required(E2E_BASE_URL_ENV);

/** Runs seed SQL against the live e2e database via the stack's control plane. */
export const seedServerE2ESql = async (sql: string): Promise<void> => {
  const response = await fetch(`${required(E2E_CONTROL_URL_ENV)}/sql`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: sql,
  });

  if (!response.ok) {
    throw new Error(`Seed SQL failed (${String(response.status)}): ${await response.text()}`);
  }
};
