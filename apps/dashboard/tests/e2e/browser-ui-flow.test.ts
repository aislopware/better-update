import { randomUUID } from "node:crypto";

import type { Page } from "playwright";

import { createSharedBrowserRuntime } from "../helpers/browser-helpers";
import { setupE2EDashboard } from "../helpers/e2e-dashboard";

const { getBaseUrl, post } = setupE2EDashboard();
const runtime = createSharedBrowserRuntime();

const password = "SecureP@ss123";
const toSlug = (value: string) => value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");

const createUser = async (label: string) => {
  const suffix = `${toSlug(label)}-${randomUUID().slice(0, 8)}`;
  const email = `${suffix}@example.com`;
  const response = await post("/api/auth/sign-up/email", {
    name: `Browser ${label}`,
    email,
    password,
  });

  expect(response.status).toBe(200);
  return { email, password };
};

const login = async (page: Page, email: string) => {
  await page.goto(`${getBaseUrl()}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
};

const completeOnboarding = async (
  page: Page,
  organizationName: string,
  organizationSlug: string,
) => {
  await page.waitForURL(/\/onboarding$/);
  await page.getByLabel("Organization name").fill(organizationName);
  await page.getByLabel("URL slug").fill(organizationSlug);
  await page.getByRole("button", { name: "Create organization" }).click();
  await page.waitForURL(/\/projects$/);
};

const createProject = async (page: Page, projectName: string, scopeKey: string) => {
  await page.getByRole("button", { name: "Create project" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Project name").fill(projectName);
  await dialog.getByLabel("Scope key").fill(scopeKey);
  await dialog.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("link", { name: new RegExp(projectName) }).waitFor();
};

const openProject = async (page: Page, projectName: string) => {
  await page.getByRole("link", { name: new RegExp(projectName) }).click();
  await page.waitForURL(/\/projects\/[^/]+$/);
  await page.getByRole("heading", { name: projectName }).waitFor();
};

interface ProjectJourney {
  readonly projectName: string;
}

const completeProjectJourney = async (
  page: Page,
  label: string,
  scopeOwner: string,
): Promise<ProjectJourney> => {
  const user = await createUser(label);
  const orgSuffix = randomUUID().slice(0, 8);
  const projectSuffix = randomUUID().slice(0, 8);
  const normalizedLabel = toSlug(label);
  const organizationName = `${label} org ${orgSuffix}`;
  const organizationSlug = `${normalizedLabel}-org-${orgSuffix}`;
  const projectName = `${label} project ${projectSuffix}`;
  const scopeKey = `@${scopeOwner}/${projectSuffix}`;

  await login(page, user.email);
  await completeOnboarding(page, organizationName, organizationSlug);
  await createProject(page, projectName, scopeKey);
  await openProject(page, projectName);

  return { projectName };
};

describe("Dashboard browser UI journey", () => {
  beforeAll(async () => {
    await runtime.setup();
  });

  afterAll(async () => {
    await runtime.teardown();
  });

  test("signs in, completes onboarding, creates a project, and creates a branch", async () => {
    await runtime.withPage(async (page) => {
      const { projectName } = await completeProjectJourney(page, "Branch Browser", "browser");
      const branchSuffix = randomUUID().slice(0, 8);
      const branchName = `staging-${branchSuffix}`;

      await page.getByRole("button", { name: "Create branch" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Branch name").fill(branchName);
      await dialog.getByRole("button", { name: "Create branch" }).click();

      await page.getByRole("heading", { name: projectName }).waitFor();
      await page.getByText(branchName).waitFor();
    });
  });

  test("signs in, completes onboarding, creates a project, and adds an environment variable", async () => {
    await runtime.withPage(async (page) => {
      await completeProjectJourney(page, "Env Browser", "env-browser");
      const envSuffix = randomUUID().slice(0, 8);
      const envKey = `EXPO_PUBLIC_BROWSER_${envSuffix.toUpperCase()}`;
      const envValue = `https://browser-${envSuffix}.example.com`;

      await page.getByRole("tab", { name: "Env Variables" }).click();
      await page.getByRole("button", { name: "Add variable" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Key").fill(envKey);
      await dialog.getByLabel("Value").fill(envValue);
      await dialog.getByRole("button", { name: "Add variable" }).click();

      await page.getByRole("cell", { name: envKey }).waitFor();
      await page.getByRole("cell", { name: envValue }).waitFor();
    });
  });
});
