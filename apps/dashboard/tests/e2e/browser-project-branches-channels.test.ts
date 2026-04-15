import type { BrowserContext, Page } from "playwright";

import {
  completeOnboardingViaUI,
  createBrowserRuntime,
  createProjectViaUI,
  E2E_DEFAULT_TIMEOUT_MS,
  expectToast,
  gotoTabViaUI,
  openProjectFromListViaUI,
  shortId,
  signUpViaUI,
  toSlug,
  uniqueEmail,
} from "../helpers/browser-helpers";
import { setupE2EDashboard } from "../helpers/e2e-dashboard";

const dashboard = setupE2EDashboard(".wrangler/state/e2e-dash-project-branches-channels");
const runtime = createBrowserRuntime();

const suffix = shortId();
const owner = {
  name: `Lifecycle ${suffix}`,
  email: uniqueEmail("lifecycle"),
};
const orgName = `Lifecycle Org ${suffix}`;
const projectName = `Lifecycle Project ${suffix}`;
const scopeKey = `@lifecycle/${suffix}`;

const mainBranchName = `main-${suffix}`;
const stagingBranchName = `staging-${suffix}`;
const renamedStagingBranchName = `preview-${suffix}`;
const rolloutBranchName = `release-${suffix}`;
const channelName = `prod-${suffix}`;

let context: BrowserContext;
let page: Page;

beforeAll(async () => {
  await runtime.setup();
  context = await runtime.getBrowser().newContext();
  page = await context.newPage();
  page.setDefaultTimeout(E2E_DEFAULT_TIMEOUT_MS);

  await signUpViaUI(page, dashboard.getBaseUrl(), owner);
  await completeOnboardingViaUI(page, {
    organizationName: orgName,
    organizationSlug: toSlug(orgName),
  });
});

afterAll(async () => {
  await context.close();
  await runtime.teardown();
});

// ── Local helpers ─────────────────────────────────────────────────────────

const createBranchViaUI = async (branchName: string): Promise<void> => {
  await page.getByRole("button", { name: "Create branch" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Branch name").fill(branchName);
  await dialog.getByRole("button", { name: "Create branch" }).click();
  await expectToast(page, "Branch created");
  await dialog.waitFor({ state: "detached" });
  await page.getByText(branchName).first().waitFor();
};

const branchCardLocator = (branchName: string) =>
  page.locator('[data-slot="card"]').filter({ hasText: branchName }).first();

const channelCardLocator = () =>
  page.locator('[data-slot="card"]').filter({ hasText: channelName }).first();

// ── Tests ─────────────────────────────────────────────────────────────────

describe("Dashboard project + branches + channels (browser)", () => {
  test("creates a project", async () => {
    await createProjectViaUI(page, { name: projectName, scopeKey });
    await openProjectFromListViaUI(page, projectName);
  });

  test("creates branches", async () => {
    await createBranchViaUI(mainBranchName);
    await createBranchViaUI(stagingBranchName);
  });

  test("renames a branch", async () => {
    const card = branchCardLocator(stagingBranchName);
    // Rename is the first icon-only ghost button inside the branch card header
    const iconButtons = card.locator("button").filter({ hasNotText: /\S/u });
    await iconButtons.nth(0).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Rename branch" }).waitFor();
    const nameInput = dialog.getByLabel("Branch name");
    await nameInput.fill(renamedStagingBranchName);
    await dialog.getByRole("button", { name: "Rename" }).click();
    await expectToast(page, "Branch renamed");
    await page.getByText(renamedStagingBranchName).first().waitFor();
  });

  test("deletes a branch via confirm dialog", async () => {
    const card = branchCardLocator(renamedStagingBranchName);
    const iconButtons = card.locator("button").filter({ hasNotText: /\S/u });
    await iconButtons.nth(1).click();

    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("heading", { name: new RegExp(`Delete ${renamedStagingBranchName}`, "u") })
      .waitFor();
    await dialog.getByLabel(/type.*to confirm/iu).fill(renamedStagingBranchName);
    await dialog.getByRole("button", { name: "Delete permanently" }).click();
    await expectToast(page, "Branch deleted");
    await dialog.waitFor({ state: "detached" });
    await branchCardLocator(renamedStagingBranchName).waitFor({ state: "detached" });
  });

  test("creates a channel linked to the main branch", async () => {
    await gotoTabViaUI(page, "Channels");

    await page.getByRole("button", { name: "Create channel" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Create a channel" }).waitFor();
    await dialog.getByLabel("Name").fill(channelName);

    // Branch select is a Radix combobox inside the dialog
    await dialog.getByRole("combobox").click();
    await page.getByRole("option", { name: mainBranchName }).click();

    await dialog.getByRole("button", { name: "Create channel" }).click();
    await expectToast(page, "Channel created");
    await page.getByText(channelName, { exact: true }).waitFor();
  });

  test("relinks channel to a different branch", async () => {
    // Seed an extra branch for rollout/relink scenarios
    await gotoTabViaUI(page, "Branches");
    await createBranchViaUI(rolloutBranchName);
    await gotoTabViaUI(page, "Channels");

    // Channel card branch relink is the first combobox on the page
    const card = channelCardLocator();
    await card.getByRole("combobox").click();
    await page.getByRole("option", { name: rolloutBranchName }).click();
    await expectToast(page, "Channel relinked");

    // Relink back to main so rollout uses rolloutBranch as target
    await card.getByRole("combobox").click();
    await page.getByRole("option", { name: mainBranchName }).click();
    await expectToast(page, "Channel relinked");
  });

  test("pauses and resumes the channel", async () => {
    const card = channelCardLocator();
    // Pause/resume is an unlabeled ghost icon button in the card header.
    // It is the first icon-only button in the card (rename/delete channel follows).
    const iconButtons = card.locator("button").filter({ hasNotText: /\S/u });

    // The first icon-only button is pause/resume; we expect at least one
    await iconButtons.nth(0).click();
    await expectToast(page, "Channel paused");
    await card.getByText("Paused").waitFor();

    await iconButtons.nth(0).click();
    await expectToast(page, "Channel resumed");
    await card.getByText("Paused").waitFor({ state: "detached" });
  });

  test("starts a branch rollout and adjusts percentage", async () => {
    const card = channelCardLocator();

    await card.getByRole("button", { name: /Start Rollout/iu }).click();

    // Inline form appears with a target-branch combobox + percentage input + Start button
    await card.getByRole("combobox").nth(1).click();
    await page.getByRole("option", { name: rolloutBranchName }).click();

    await card.getByRole("spinbutton").fill("25");
    await card.getByRole("button", { name: "Start", exact: true }).click();
    await expectToast(page, /Branch rollout started at 25%/u);
    await card.getByText(/Rolling out/u).waitFor();

    // Adjust the rollout percentage
    const rolloutInput = card.getByRole("spinbutton");
    await rolloutInput.fill("50");
    await card.getByRole("button", { name: "Apply", exact: true }).click();
    await expectToast(page, /Rollout updated to 50%/u);
  });

  test("reverts the in-progress rollout", async () => {
    const card = channelCardLocator();
    await card.getByRole("button", { name: /Revert rollout/iu }).click();
    await expectToast(page, /Rollout reverted/u);
    await card.getByText(/Rolling out/u).waitFor({ state: "detached" });
  });

  test("starts a second rollout and completes it", async () => {
    const card = channelCardLocator();
    await card.getByRole("button", { name: /Start Rollout/iu }).click();
    await card.getByRole("combobox").nth(1).click();
    await page.getByRole("option", { name: rolloutBranchName }).click();
    await card.getByRole("spinbutton").fill("10");
    await card.getByRole("button", { name: "Start", exact: true }).click();
    await expectToast(page, /Branch rollout started at 10%/u);

    await card.getByRole("button", { name: /Complete rollout/iu }).click();
    await expectToast(page, /Rollout completed/u);
    // After completion the channel now serves rolloutBranch
    await card.getByText(/Rolling out/u).waitFor({ state: "detached" });
  });

  test("navigates to the channel detail page", async () => {
    const card = channelCardLocator();
    await card.getByRole("link", { name: "View details" }).click();
    await page.waitForURL(/\/projects\/[^/]+\/channels\/[^/]+$/u);
    await page.getByRole("heading", { name: channelName }).waitFor();

    await page.goBack();
    await page.waitForURL(/\/projects\/[^/]+$/u);
    await page.getByRole("tab", { name: "Branches" }).waitFor();
  });

  test("deletes the channel via confirm dialog", async () => {
    await gotoTabViaUI(page, "Channels");
    const card = channelCardLocator();
    const iconButtons = card.locator("button").filter({ hasNotText: /\S/u });
    // After pause/resume button, delete dialog trigger is the next icon-only button
    await iconButtons.nth(1).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: new RegExp(`Delete ${channelName}`, "u") }).waitFor();
    await dialog.getByLabel(/type.*to confirm/iu).fill(channelName);
    await dialog.getByRole("button", { name: "Delete permanently" }).click();
    await expectToast(page, "Channel deleted");
    await dialog.waitFor({ state: "detached" });
    await channelCardLocator().waitFor({ state: "detached" });
  });

  test("renames the project via the settings section", async () => {
    const newName = `${projectName} renamed`;
    await page.getByLabel("Project name").fill(newName);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expectToast(page, "Project renamed");
    await page.getByRole("heading", { name: newName }).waitFor();
  });

  test("deletes the project via the danger zone confirm dialog", async () => {
    const currentName = `${projectName} renamed`;
    await page.getByRole("button", { name: "Delete project" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: new RegExp(`Delete ${currentName}`, "u") }).waitFor();
    await dialog.getByLabel(/type.*to confirm/iu).fill(currentName);
    await dialog.getByRole("button", { name: "Delete permanently" }).click();
    await expectToast(page, "Project deleted");
    await page.waitForURL(/\/projects(?:$|\?)/u);
  });
});
