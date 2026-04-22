import { randomUUID } from "node:crypto";

import type { Page } from "playwright";

import {
  completeOnboardingViaUI,
  createProjectViaUI,
  createSharedBrowserRuntime,
  gotoTabViaUI,
  openProjectFromListViaUI,
  signUpViaUI,
  toSlug,
  uniqueEmail,
} from "../helpers/browser-helpers";
import { setupE2EDashboard } from "../helpers/e2e-dashboard";

const dashboard = setupE2EDashboard();
const runtime = createSharedBrowserRuntime();

interface ProjectJourney {
  readonly projectName: string;
}

const completeProjectJourney = async (page: Page, label: string): Promise<ProjectJourney> => {
  const suffix = randomUUID().slice(0, 8);
  const normalizedLabel = toSlug(label);
  const organizationName = `${label} org ${suffix}`;
  const organizationSlug = `${normalizedLabel}-org-${suffix}`;
  const projectName = `${label} project ${suffix}`;
  const projectSlug = `${normalizedLabel}-${suffix}`;

  await signUpViaUI(page, dashboard.getBaseUrl(), {
    name: `Browser ${label}`,
    email: uniqueEmail(normalizedLabel),
  });
  await completeOnboardingViaUI(page, { organizationName, organizationSlug });
  await createProjectViaUI(page, { name: projectName, slug: projectSlug });
  await openProjectFromListViaUI(page, projectName);

  return { projectName };
};

describe("dashboard browser UI journey", () => {
  beforeAll(async () => {
    await runtime.setup();
  });

  afterAll(async () => {
    await runtime.teardown();
  });

  it("signs in, completes onboarding, creates a project, and creates a branch", async () => {
    await runtime.withPage(async (page) => {
      const { projectName } = await completeProjectJourney(page, "Branch Browser");
      const branchSuffix = randomUUID().slice(0, 8);
      const branchName = `staging-${branchSuffix}`;

      await gotoTabViaUI(page, "Branches");
      await page.getByRole("button", { name: "Create branch" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Branch name").fill(branchName);
      await dialog.getByRole("button", { name: "Create branch" }).click();

      await page
        .getByRole("button", { name: new RegExp(projectName, "u") })
        .first()
        .waitFor();
      await page.getByText(branchName).waitFor();
    });
  });

  it("signs in, completes onboarding, creates a project, and adds an environment variable", async () => {
    await runtime.withPage(async (page) => {
      await completeProjectJourney(page, "Env Browser");
      const envSuffix = randomUUID().slice(0, 8);
      const envKey = `EXPO_PUBLIC_BROWSER_${envSuffix.toUpperCase()}`;
      const envValue = `https://browser-${envSuffix}.example.com`;

      await gotoTabViaUI(page, "Env Variables");
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
