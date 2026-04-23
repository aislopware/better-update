import type { BrowserContext, Page } from "playwright";

import {
  createSharedBrowserRuntime,
  dismissToasts,
  E2E_DEFAULT_TIMEOUT_MS,
  expectToast,
  gotoTabViaUI,
  loginViaUI,
  shortId,
  uniqueEmail,
  waitForPortalCleanup,
} from "../helpers/browser-helpers";
import { setupE2EDashboard } from "../helpers/e2e-dashboard";
import {
  patchUpdateRollout,
  seedAssetAndFinalize,
  seedBranch,
  seedBuild,
  seedChannel,
  seedUpdate,
  seedUserOrgProject,
} from "../helpers/web-seeder";

const dashboard = setupE2EDashboard();
const runtime = createSharedBrowserRuntime();

const suffix = shortId();
const owner = {
  name: `Updates ${suffix}`,
  email: uniqueEmail("updates"),
};
const projectName = `Updates Project ${suffix}`;
const slug = `updates-${suffix}`;
const mainBranchName = "main";
const stagingBranchName = "staging";
const stagingChannelName = "staging";

let context: BrowserContext;
let page: Page;
let cookies: string;
let projectId: string;
let iosBuildId: string;

beforeAll(async () => {
  await runtime.setup();

  const seeded = await seedUserOrgProject({
    dashboard,
    name: owner.name,
    email: owner.email,
    orgName: `Updates Org ${suffix}`,
    orgSlug: `updates-${suffix}`,
    projectName,
    slug,
  });
  ({ cookies, projectId } = seeded);

  const mainBranchId = await seedBranch({
    dashboard,
    cookies,
    projectId,
    name: mainBranchName,
  });
  const stagingBranchId = await seedBranch({
    dashboard,
    cookies,
    projectId,
    name: stagingBranchName,
  });
  await seedChannel({
    dashboard,
    cookies,
    projectId,
    name: "production",
    branchId: mainBranchId,
  });
  await seedChannel({
    dashboard,
    cookies,
    projectId,
    name: stagingChannelName,
    branchId: stagingBranchId,
  });

  // Main update covers rollout/promote/rollback/delete; staging update covers branch filter.
  const assetHash = await seedAssetAndFinalize({
    dashboard,
    cookies,
    projectId,
    content: `console.log('${suffix}-main')`,
  });
  const updateMainId = await seedUpdate({
    dashboard,
    cookies,
    slug,
    branch: mainBranchName,
    assetHash,
    message: "Main update",
    groupId: `group-main-${suffix}`,
  });
  await patchUpdateRollout({ dashboard, cookies, updateId: updateMainId, percentage: 50 });

  const stagingAssetHash = await seedAssetAndFinalize({
    dashboard,
    cookies,
    projectId,
    content: `console.log('${suffix}-staging')`,
  });
  await seedUpdate({
    dashboard,
    cookies,
    slug,
    branch: stagingBranchName,
    assetHash: stagingAssetHash,
    message: "Staging update",
    groupId: `group-staging-${suffix}`,
  });

  iosBuildId = await seedBuild({
    dashboard,
    cookies,
    projectId,
    platform: "ios",
    distribution: "ad-hoc",
    artifactFormat: "ipa",
    message: "iOS seed build",
    buildNumber: "1",
  });
  await seedBuild({
    dashboard,
    cookies,
    projectId,
    platform: "android",
    distribution: "direct",
    artifactFormat: "apk",
    message: "Android seed build",
    buildNumber: "2",
  });

  context = await runtime.getBrowser().newContext();
  page = await context.newPage();
  page.setDefaultTimeout(E2E_DEFAULT_TIMEOUT_MS);
  await loginViaUI(page, dashboard.getBaseUrl(), { email: owner.email });
  await page.waitForURL(/\/projects(?:$|\/|\?)/u);
  await page.goto(`${dashboard.getBaseUrl()}/projects/${slug}`);
  await page
    .getByRole("button", { name: new RegExp(projectName, "u") })
    .first()
    .waitFor();
});

afterAll(async () => {
  await context.close();
  await runtime.teardown();
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe("dashboard updates + env vars + builds (browser)", () => {
  it("updates tab shows seeded updates", async () => {
    await gotoTabViaUI(page, "Updates");
    await page.getByText("Main update").first().waitFor();
    await page.getByText("Staging update").first().waitFor();
  });

  it("filters updates by branch", async () => {
    await gotoTabViaUI(page, "Updates");
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: stagingBranchName }).click();

    await page.getByText("Staging update").first().waitFor();
    await page
      .locator('[data-slot="card"]')
      .filter({ hasText: "Main update" })
      .waitFor({ state: "detached" });

    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "All branches" }).click();
    await page.getByText("Main update").first().waitFor();
  });

  it("promotes an update to another channel via dialog", async () => {
    await gotoTabViaUI(page, "Updates");
    const mainCard = page.locator('[data-slot="card"]').filter({ hasText: "Main update" }).first();
    await mainCard.getByRole("button", { name: /Promote to another channel/iu }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Promote update" }).waitFor();
    await dialog.getByRole("combobox").click();
    await page.getByRole("option", { name: stagingChannelName }).click();
    await dialog.getByRole("button", { name: "Promote", exact: true }).click();
    await expectToast(page, "Update promoted successfully");
    await dialog.waitFor({ state: "detached" });
  });

  it("creates a rollback-to-embedded directive via dialog", async () => {
    await gotoTabViaUI(page, "Updates");
    const mainCard = page.locator('[data-slot="card"]').filter({ hasText: "Main update" }).first();
    await mainCard.getByRole("button", { name: /Rollback to embedded/iu }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Rollback to embedded" }).waitFor();
    await dialog.getByRole("button", { name: "Create rollback" }).click();
    await expectToast(page, "Rollback directive created");
    await dialog.waitFor({ state: "detached" });

    await page.getByText("Rollback to embedded").first().waitFor();
  });

  it("adjusts update rollout percentage via Apply", async () => {
    await gotoTabViaUI(page, "Updates");
    const mainCard = page.locator('[data-slot="card"]').filter({ hasText: "Main update" }).first();
    const input = mainCard.getByRole("spinbutton");
    await input.fill("75");
    await mainCard.getByRole("button", { name: "Apply", exact: true }).click();
    await expectToast(page, /Rollout updated to 75%/u);
  });

  it("reverts update rollout to 0%", async () => {
    await gotoTabViaUI(page, "Updates");
    const mainCard = page.locator('[data-slot="card"]').filter({ hasText: "Main update" }).first();
    await mainCard.getByRole("button", { name: /Revert rollout/iu }).click();
    await expectToast(page, /Rollout reverted/u);
  });

  it("completes update rollout to 100%", async () => {
    await gotoTabViaUI(page, "Updates");
    const mainCard = page.locator('[data-slot="card"]').filter({ hasText: "Main update" }).first();
    // After revert, percentage is 0. Bump it so Apply works, then click Complete.
    const input = mainCard.getByRole("spinbutton");
    await input.fill("25");
    await mainCard.getByRole("button", { name: "Apply", exact: true }).click();
    await expectToast(page, /Rollout updated to 25%/u);

    await mainCard.getByRole("button", { name: /Complete rollout/iu }).click();
    await expectToast(page, /Rollout completed/u);
  });

  it("deletes an update group", async () => {
    await gotoTabViaUI(page, "Updates");
    const stagingCard = page
      .locator('[data-slot="card"]')
      .filter({ hasText: "Staging update" })
      .first();
    await stagingCard.getByRole("button", { name: /Delete update group/iu }).click();
    await expectToast(page, "Update group deleted");
    await page
      .locator('[data-slot="card"]')
      .filter({ hasText: "Staging update" })
      .waitFor({ state: "detached" });
  });

  // ── Env vars ─────────────────────────────────────────────────────────────

  it("creates a plaintext env variable", async () => {
    await gotoTabViaUI(page, "Env Variables");

    await page.getByRole("button", { name: "Add variable" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Add environment variable" }).waitFor();
    await dialog.getByLabel("Key").fill(`EXPO_PUBLIC_API_URL_${suffix.toUpperCase()}`);
    await dialog.getByLabel("Value").fill("https://api.example.com");
    await dialog.getByRole("button", { name: "Add variable" }).click();
    await expectToast(page, /created/u);

    await page.getByRole("cell", { name: `EXPO_PUBLIC_API_URL_${suffix.toUpperCase()}` }).waitFor();
  });

  it("edits the env variable value", async () => {
    await gotoTabViaUI(page, "Env Variables");

    const row = page
      .getByRole("row")
      .filter({ hasText: `EXPO_PUBLIC_API_URL_${suffix.toUpperCase()}` });
    await row.getByRole("button").click();
    await page.getByRole("menuitem", { name: "Edit" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Edit variable" }).waitFor();
    await dialog.getByLabel("Value").fill("https://api.updated.example.com");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expectToast(page, /updated/u);

    await page.getByRole("cell", { name: "https://api.updated.example.com" }).waitFor();
  });

  it("deletes the env variable", async () => {
    await gotoTabViaUI(page, "Env Variables");

    const row = page
      .getByRole("row")
      .filter({ hasText: `EXPO_PUBLIC_API_URL_${suffix.toUpperCase()}` });
    await row.getByRole("button").click();
    await page.getByRole("menuitem", { name: "Delete" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Delete variable?" }).waitFor();
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expectToast(page, /deleted/u);

    await page
      .getByRole("cell", { name: `EXPO_PUBLIC_API_URL_${suffix.toUpperCase()}` })
      .waitFor({ state: "detached" });
  });

  it("opens the import env vars dialog", async () => {
    await gotoTabViaUI(page, "Env Variables");
    await page.getByRole("button", { name: "Import .env" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Import environment variables" }).waitFor();
    await dialog.getByLabel("Content").waitFor();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    await page
      .locator('[data-slot="dialog-overlay"]')
      .waitFor({ state: "detached", timeout: 3000 })
      .catch(() => {});
    await waitForPortalCleanup(page);
  });

  // ── Builds ───────────────────────────────────────────────────────────────

  it("builds tab lists seeded builds", async () => {
    await gotoTabViaUI(page, "Builds");
    await page
      .locator('[data-slot="card"]')
      .filter({ hasText: "iOS seed build" })
      .first()
      .waitFor();
    await page
      .locator('[data-slot="card"]')
      .filter({ hasText: "Android seed build" })
      .first()
      .waitFor();
  });

  it("filters builds by platform", async () => {
    await dismissToasts(page);
    await gotoTabViaUI(page, "Builds");
    await page
      .locator('[data-slot="card"]')
      .filter({ hasText: "iOS seed build" })
      .first()
      .waitFor();

    const selectPlatform = async (optionName: string): Promise<void> => {
      await page.getByRole("combobox").first().click();
      await page.getByRole("option", { name: optionName, exact: true }).click();
      await waitForPortalCleanup(page);
    };

    await selectPlatform("iOS");
    await page
      .locator('[data-slot="card"]')
      .filter({ hasText: "Android seed build" })
      .waitFor({ state: "detached" });

    await selectPlatform("Android");
    await page
      .locator('[data-slot="card"]')
      .filter({ hasText: "iOS seed build" })
      .waitFor({ state: "detached" });
    await page
      .locator('[data-slot="card"]')
      .filter({ hasText: "Android seed build" })
      .first()
      .waitFor();

    await selectPlatform("All platforms");
    await page
      .locator('[data-slot="card"]')
      .filter({ hasText: "iOS seed build" })
      .first()
      .waitFor();
  });

  it("opens the install link dialog for a build", async () => {
    await gotoTabViaUI(page, "Builds");
    // `.last()` skips the CompatibilityMatrix Card (which also contains the
    // Build message) and picks the BuildCard that owns the action buttons.
    const iosCard = page.locator('[data-slot="card"]').filter({ hasText: "iOS seed build" }).last();
    await iosCard.getByRole("button", { name: "Install link" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Install link" }).waitFor();
    await dialog
      .getByText(/install link|download link|Generating/iu)
      .first()
      .waitFor();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    await waitForPortalCleanup(page);
  });

  it("opens build detail and verifies metadata, artifact, and compatible channels", async () => {
    await gotoTabViaUI(page, "Builds");
    const iosCard = page.locator('[data-slot="card"]').filter({ hasText: "iOS seed build" }).last();
    await iosCard.getByRole("link", { name: "View details" }).click();
    await page.waitForURL(new RegExp(`/projects/${slug}/builds/${iosBuildId}$`, "u"));
    await page.getByRole("heading", { name: "iOS seed build" }).waitFor();

    // Build metadata card
    await page.getByText("Build metadata").waitFor();
    await page.getByText("Runtime version").waitFor();
    await page.locator("text=1.0.0").first().waitFor();
    await page.getByText("Bundle ID").waitFor();
    await page.getByText("com.test.ios").waitFor();
    await page.getByText("App version").waitFor();
    await page.getByText("Build number").waitFor();

    // Artifact card
    await page.getByText("Artifact").first().waitFor();
    await page.getByRole("link", { name: "Download artifact" }).waitFor();
    await page.getByRole("button", { name: /Install.*copy link/iu }).waitFor();
    await page.getByText("SHA-256").waitFor();

    // Related channels card
    await page
      .getByText("Open a channel detail page to inspect rollout and update state.")
      .waitFor();

    await page.goBack();
    await page.waitForURL(new RegExp(`/projects/${slug}/builds$`, "u"));
    await page.getByRole("link", { name: "Branches", exact: true }).first().waitFor();
  });

  it("deletes a build via confirm dialog", async () => {
    await gotoTabViaUI(page, "Builds");
    const androidCard = page
      .locator('[data-slot="card"]')
      .filter({ hasText: "Android seed build" })
      .last();
    await androidCard.getByRole("button", { name: "Delete build" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Delete build?" }).waitFor();
    await dialog.getByLabel(/type.*to confirm/iu).fill("Android seed build");
    await dialog.getByRole("button", { name: "Delete permanently" }).click();
    await expectToast(page, "Build deleted");
    await dialog.waitFor({ state: "detached" });
    await page
      .locator('[data-slot="card"]')
      .filter({ hasText: "Android seed build" })
      .last()
      .waitFor({ state: "detached" });
  });
});
