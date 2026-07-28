import { startServerE2EStack } from "../../../server/tests/helpers/e2e-harness";

/**
 * Boots one server Worker for the whole CLI e2e run. The CLI under test is a
 * real subprocess (`dist/index.mjs`) speaking real HTTP, so it needs a listening
 * port — `createTestHarness` provides one; the in-runtime `vitest-pool-workers`
 * path the server's own suites use cannot.
 *
 * `update publish` / `build upload` PUT bytes to a presigned
 * `*.r2.cloudflarestorage.com` URL and the Worker then reads the object back
 * through its binding, so the binding has to point at the same real bucket —
 * hence `remoteR2`.
 *
 * The stack publishes its URLs on `process.env`; test files read them through
 * `e2e-harness-client`, which is why nothing is written to disk here.
 */
export default async function setup(): Promise<() => Promise<void>> {
  const stack = await startServerE2EStack({ remoteR2: true });
  return stack.stop;
}
