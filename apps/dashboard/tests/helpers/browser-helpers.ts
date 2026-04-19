import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { chromium } from "playwright";

import type { Browser, BrowserContext, Page } from "playwright";

import { ENV_FILE } from "../e2e/global-setup";

import type { SharedE2EEnv } from "../e2e/global-setup";

export const DEFAULT_PASSWORD = "SecureP@ss123";

export const E2E_DEFAULT_TIMEOUT_MS = 10_000;

export const toSlug = (value: string): string => value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");

export const shortId = (): string => randomUUID().slice(0, 8);

export const uniqueEmail = (prefix: string): string => `${prefix}-${shortId()}@example.com`;

export interface BrowserRuntime {
  readonly getBrowser: () => Browser;
  readonly setup: () => Promise<void>;
  readonly teardown: () => Promise<void>;
  readonly withPage: (run: (page: Page, context: BrowserContext) => Promise<void>) => Promise<void>;
}

let _sharedEnv: SharedE2EEnv | undefined;

const getSharedEnv = (): SharedE2EEnv => {
  _sharedEnv ??= JSON.parse(readFileSync(ENV_FILE, "utf8")) as SharedE2EEnv;
  return _sharedEnv;
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

// ── Auth flows via the dashboard UI ───────────────────────────────────────

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
  await page.goto(`${baseUrl}/signup`);
  await page.getByLabel("Name").fill(params.name);
  await page.getByLabel("Email").fill(params.email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
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
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel("Email").fill(params.email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
};

export const logoutViaUI = async (page: Page, userName: string): Promise<void> => {
  await page
    .getByRole("button", { name: new RegExp(userName, "u") })
    .last()
    .click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await page.waitForURL(/\/login$/u);
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
  await page.getByRole("heading", { name: projectName }).waitFor();
};

export const gotoTabViaUI = async (
  page: Page,
  tabName: "Branches" | "Channels" | "Updates" | "Builds" | "Analytics" | "Env Variables",
): Promise<void> => {
  await page.getByRole("tab", { name: tabName }).click();
};
