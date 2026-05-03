import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { chromium } from "playwright";

import type { Browser, BrowserContext, Page } from "playwright";

import { ENV_FILE } from "../e2e/global-setup";

import type { SharedE2EEnv } from "../e2e/global-setup";

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

let cachedEnv: SharedE2EEnv | undefined;

const getSharedEnv = (): SharedE2EEnv => {
  cachedEnv ??= JSON.parse(readFileSync(ENV_FILE, "utf8")) as SharedE2EEnv;
  return cachedEnv;
};

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
      const { browserWSEndpoint } = getSharedEnv();
      browser = await chromium.connect(browserWSEndpoint);
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
  const response = await page.context().request.post(`${baseUrl}/api/auth/sign-up/email`, {
    data: { name: params.name, email: params.email, password },
  });
  if (!response.ok()) {
    throw new Error(`signUpViaUI failed: ${response.status()} ${await response.text()}`);
  }
  await page.goto(`${baseUrl}/onboarding`);
  await page.waitForURL(/\/onboarding$/u);
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
  await page.waitForURL(/\/projects(?:$|\/|\?)/u);
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
    data: { email: params.email, password },
  });
  if (!response.ok()) {
    throw new Error(`loginViaUI failed: ${response.status()} ${await response.text()}`);
  }
  await page.goto(`${baseUrl}/onboarding`);
};

export const logoutViaUI = async (page: Page, userName: string): Promise<void> => {
  await page
    .getByRole("button", { name: new RegExp(userName, "u") })
    .last()
    .click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await page.waitForURL(/\/(?:auth\/)?login(?:$|\?)/u);
};

// ── Project / navigation helpers ──────────────────────────────────────────

export const expectToast = async (page: Page, text: string | RegExp): Promise<void> => {
  await page.getByText(text).first().waitFor({ state: "visible", timeout: 15_000 });
};

export const dismissToasts = async (page: Page): Promise<void> => {
  // Visually hide toasts via CSS — do NOT remove them from the DOM, since
  // Sonner/React still own those nodes and later unmount via removeChild.
  // Directly removing the nodes crashes React with "The node to be removed
  // Is not a child of this node."
  await page.addStyleTag({
    content:
      "[data-sonner-toast], [data-sonner-toaster] { opacity: 0 !important; pointer-events: none !important; }",
  });
};

export const waitForPortalCleanup = async (page: Page): Promise<void> => {
  await page
    .locator("[data-base-ui-portal]")
    .last()
    .waitFor({ state: "detached", timeout: 3000 })
    .catch(() => {});
};

export const createProjectViaUI = async (
  page: Page,
  params: {
    readonly name: string;
    readonly slug: string;
  },
): Promise<void> => {
  await page.getByRole("button", { name: "Create project" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Project name").fill(params.name);
  await dialog.getByLabel("Slug").fill(params.slug);
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expectToast(page, "Project created");
  await page.getByRole("link", { name: new RegExp(params.name, "u") }).waitFor();
};

export const openProjectFromListViaUI = async (page: Page, projectName: string): Promise<void> => {
  await page.getByRole("link", { name: new RegExp(projectName, "u") }).click();
  await page.waitForURL(/\/projects\/[^/]+$/u);
  // The project overview page no longer renders the project name as a heading
  // (see refactor 593b8ad). Project identity now lives in the breadcrumb's
  // ProjectSwitcher button — match that as the readiness signal instead.
  await page
    .getByRole("button", { name: new RegExp(projectName, "u") })
    .first()
    .waitFor();
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
