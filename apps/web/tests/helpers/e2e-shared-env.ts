/**
 * Web-specific half of the e2e stack handoff. Kept separate from
 * `tests/e2e/global-setup.ts` on purpose: that module imports playwright and the
 * wrangler-backed harness, and importing it from a test helper would load both
 * into every test-worker process.
 *
 * The server Worker's own URLs come from `e2e-harness-client` instead.
 */

import { env } from "node:process";

export const E2E_WEB_URL_ENV = "BETTER_UPDATE_E2E_WEB_URL";
export const E2E_BROWSER_WS_ENV = "BETTER_UPDATE_E2E_BROWSER_WS";

const required = (name: string): string => {
  const value = env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. The e2e stack publishes it from globalSetup — is this test running outside the e2e projects?`,
    );
  }
  return value;
};

/** Origin of the vite dev server the dashboard and API tests talk to. */
export const webE2EBaseUrl = (): string => required(E2E_WEB_URL_ENV);

/** WebSocket endpoint of the shared chromium server. */
export const webE2EBrowserWSEndpoint = (): string => required(E2E_BROWSER_WS_ENV);
