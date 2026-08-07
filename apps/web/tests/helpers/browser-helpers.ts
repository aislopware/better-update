import { randomUUID } from "node:crypto";

import { chromium } from "playwright";

import type { Browser, BrowserContext, Page } from "playwright";

import { webE2EBrowserWSEndpoint } from "./e2e-shared-env";

export const DEFAULT_PASSWORD = "SecureP@ss123";

export const E2E_DEFAULT_TIMEOUT_MS = 20_000;

export const toSlug = (value: string): string => value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");

export const shortId = (): string => randomUUID().slice(0, 8);

export const uniqueEmail = (prefix: string): string => `${prefix}-${shortId()}@example.com`;

export interface BrowserRuntime {
  readonly getBrowser: () => Browser;
  readonly setup: () => Promise<void>;
  readonly teardown: () => Promise<void>;
  readonly withPage: (run: (page: Page, context: BrowserContext) => Promise<void>) => Promise<void>;
}

/**
 * Connects to the shared Chromium instance launched by globalSetup.
 * `teardown()` disconnects without killing the browser process.
 */
export const createSharedBrowserRuntime = (): BrowserRuntime => {
  let browser: Browser | undefined;

  return {
    getBrowser: () => {
      if (!browser) {
        throw new Error("Browser not connected. Call setup() first.");
      }
      return browser;
    },
    setup: async () => {
      browser = await chromium.connect(webE2EBrowserWSEndpoint());
    },
    teardown: async () => {
      // Disconnect only — the shared browser is managed by globalSetup.
      browser = undefined;
    },
    withPage: async (run) => {
      if (!browser) {
        throw new Error("Browser not connected. Call setup() first.");
      }
      const context = await browser.newContext();
      const page = await context.newPage();
      page.setDefaultTimeout(E2E_DEFAULT_TIMEOUT_MS);
      try {
        await run(page, context);
      } finally {
        await context.close();
      }
    },
  };
};

// ── Auth flows via the dashboard API ──────────────────────────────────────
// The login UI is GitHub-only, so tests create + authenticate users by
// Hitting Better Auth's email endpoints directly. Cookies propagate onto
// The Playwright BrowserContext automatically via `page.context().request`.

export const signUpViaUI = async (
  page: Page,
  baseUrl: string,
  params: {
    readonly name: string;
    readonly email: string;
    readonly password?: string;
  },
): Promise<void> => {
  const password = params.password ?? DEFAULT_PASSWORD;
  // Playwright's APIRequestContext is not a page fetch, so it sends no Origin
  // of its own — and better-auth's CSRF gate rejects that on its sign-in /
  // sign-up routes. Spell out the web origin, which is what the browser would
  // have sent here anyway.
  const response = await page.context().request.post(`${baseUrl}/api/auth/sign-up/email`, {
    headers: { origin: baseUrl },
    data: { name: params.name, email: params.email, password },
  });
  if (!response.ok()) {
    throw new Error(`signUpViaUI failed: ${response.status()} ${await response.text()}`);
  }
  await page.goto(`${baseUrl}/onboarding`);
  await page.waitForURL(/\/onboarding$/u);
};

/**
 * Resolves once the app has left onboarding for the authenticated shell.
 * Which route that is has moved before (`/projects`, now the `/` overview), so
 * assert on "no longer onboarding" instead of pinning a destination.
 */
export const waitForOnboarded = async (page: Page): Promise<void> => {
  await page.waitForURL((url) => !url.pathname.startsWith("/onboarding"));
  await page.getByRole("link", { name: "Projects", exact: true }).first().waitFor();
};

export const completeOnboardingViaUI = async (
  page: Page,
  params: {
    readonly organizationName: string;
    readonly organizationSlug: string;
  },
): Promise<void> => {
  await page.waitForURL(/\/onboarding$/u);
  await page.getByText("Create your organization").waitFor();
  await page.getByLabel("Organization name").fill(params.organizationName);
  await page.getByLabel("URL slug").fill(params.organizationSlug);
  await page.getByRole("button", { name: "Create organization" }).click();
  await waitForOnboarded(page);
};

export const loginViaUI = async (
  page: Page,
  baseUrl: string,
  params: {
    readonly email: string;
    readonly password?: string;
  },
): Promise<void> => {
  const password = params.password ?? DEFAULT_PASSWORD;
  const response = await page.context().request.post(`${baseUrl}/api/auth/sign-in/email`, {
    headers: { origin: baseUrl },
    data: { email: params.email, password },
  });
  if (!response.ok()) {
    throw new Error(`loginViaUI failed: ${response.status()} ${await response.text()}`);
  }
  await page.goto(`${baseUrl}/onboarding`);
};

// ── Project / navigation helpers ──────────────────────────────────────────

export const expectToast = async (page: Page, text: string | RegExp): Promise<void> => {
  await page.getByText(text).first().waitFor({ state: "visible", timeout: 15_000 });
};

export const createProjectViaUI = async (
  page: Page,
  params: {
    readonly name: string;
    readonly slug: string;
  },
): Promise<void> => {
  // Onboarding now lands on the org overview, which only links to projects —
  // the "Create project" button lives on the projects route itself.
  await page.getByRole("link", { name: "Projects", exact: true }).first().click();
  await page.getByRole("button", { name: "Create project" }).first().click();
  // Scope by slot, not role: Base UI toasts also expose role="dialog", so a
  // toast still on screen from a previous step would make this resolve to two.
  const dialog = page.locator('[role="dialog"]');
  await dialog.getByLabel("Project name").fill(params.name);
  await dialog.getByLabel("Slug").fill(params.slug);
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expectToast(page, "Project created");
  await page.getByRole("link", { name: new RegExp(params.name, "u") }).waitFor();
};

type ProjectTabName =
  | "Branches"
  | "Channels"
  | "Updates"
  | "Builds"
  | "Analytics"
  | "Env Variables";

// The old per-project tabs were replaced by dedicated sidebar routes in
// Refactor 593b8ad. Map the legacy tab label to the current sidebar link
// Label so existing tests keep reading left-to-right.
const PROJECT_TAB_LINK_LABEL: Record<ProjectTabName, string> = {
  Analytics: "Overview",
  Branches: "Branches",
  Builds: "Builds",
  Channels: "Channels",
  Updates: "Updates",
  "Env Variables": "Environment variables",
};

export const gotoTabViaUI = async (page: Page, tabName: ProjectTabName): Promise<void> => {
  const label = PROJECT_TAB_LINK_LABEL[tabName];
  await page.getByRole("link", { name: label, exact: true }).first().click();
};
