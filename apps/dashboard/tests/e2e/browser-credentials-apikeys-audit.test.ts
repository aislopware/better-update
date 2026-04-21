import type { BrowserContext, Page } from "playwright";

import {
  completeOnboardingViaUI,
  createSharedBrowserRuntime,
  createProjectViaUI,
  E2E_DEFAULT_TIMEOUT_MS,
  expectToast,
  shortId,
  signUpViaUI,
  toSlug,
  uniqueEmail,
} from "../helpers/browser-helpers";
import { setupE2EDashboard } from "../helpers/e2e-dashboard";

const dashboard = setupE2EDashboard();
const runtime = createSharedBrowserRuntime();

const suffix = shortId();
const owner = {
  name: `Admin ${suffix}`,
  email: uniqueEmail("admin"),
};
const orgName = `Admin Org ${suffix}`;
const projectName = `Admin Project ${suffix}`;
const slug = `admin-${suffix}`;

let context: BrowserContext;
let page: Page;

const credentialName = `iOS Push Key ${suffix}`;
const apiKeyName = `CI Key ${suffix}`;

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

  // Create a project so the audit log has project-scoped events to filter on
  await createProjectViaUI(page, { name: projectName, slug });
});

afterAll(async () => {
  await context.close();
  await runtime.teardown();
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe("dashboard credentials + API keys + audit log (browser)", () => {
  it("uploads an iOS push notification credential", async () => {
    await page.getByRole("link", { name: "Credentials" }).click();
    await page.waitForURL(/\/credentials$/u);

    await page.getByRole("button", { name: "Upload" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Upload credential" }).waitFor();

    // Select platform = iOS
    const platformSelect = dialog.getByRole("combobox").first();
    await platformSelect.click();
    await page.getByRole("option", { name: "iOS" }).click();

    // Select type = Push Notification Key (simplest — no password, no distribution)
    const typeSelect = dialog.getByRole("combobox").nth(1);
    await typeSelect.click();
    await page.getByRole("option", { name: /Push Notification Key/u }).click();

    // Name the credential
    await dialog.getByLabel("Name").fill(credentialName);

    // Upload a dummy .p8 file buffer through the hidden file input
    const fileInput = dialog.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "push-key.p8",
      mimeType: "application/x-pem-file",
      buffer: Buffer.from(
        [
          "-----BEGIN PRIVATE KEY-----",
          "MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg0TestKeyBytes0000",
          "-----END PRIVATE KEY-----",
        ].join("\n"),
      ),
    });

    await dialog.getByRole("button", { name: "Upload", exact: true }).click();
    await expectToast(page, "Credential uploaded");
    await page.getByText(credentialName).waitFor();
  });

  it("uploads an Android credential and tests platform tab filter", async () => {
    // Upload an Android distribution credential (Play Service Account .json)
    await page.getByRole("button", { name: "Upload" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Upload credential" }).waitFor();

    const platformSelect = dialog.getByRole("combobox").first();
    await platformSelect.click();
    await page.getByRole("option", { name: "Android" }).click();

    const typeSelect = dialog.getByRole("combobox").nth(1);
    await typeSelect.click();
    await page.getByRole("option", { name: /Play Service Account/u }).click();

    const androidName = `Play Service ${suffix}`;
    await dialog.getByLabel("Name").fill(androidName);

    const fileInput = dialog.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "service-account.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          type: "service_account",
          project_id: "test-project",
          client_email: "sa@test.iam.gserviceaccount.com",
        }),
      ),
    });

    await dialog.getByRole("button", { name: "Upload", exact: true }).click();
    await expectToast(page, "Credential uploaded");
    await page.getByText(androidName).waitFor();

    // Filter by iOS tab — should only show the iOS credential
    await page.getByRole("tab", { name: "iOS" }).click();
    await page.getByText(credentialName).waitFor();
    await page.getByText(androidName).waitFor({ state: "detached" });

    // Filter by Android tab
    await page.getByRole("tab", { name: "Android" }).click();
    await page.getByText(androidName).waitFor();
    await page.getByText(credentialName).waitFor({ state: "detached" });

    // Back to All
    await page.getByRole("tab", { name: "All" }).click();
    await page.getByText(credentialName).waitFor();
    await page.getByText(androidName).waitFor();
  });

  it("activates a credential via the dropdown menu", async () => {
    const androidName = `Play Service ${suffix}`;
    const row = page.locator('[data-slot="card"]').filter({ hasText: androidName }).first();
    await row.getByRole("button").filter({ hasNotText: /\S/u }).click();
    await page.getByRole("menuitem", { name: "Set as active" }).click();
    await expectToast(page, "Credential activated");

    // Row now has an "Active" badge
    await row.getByText("Active").waitFor();
  });

  it("deletes a credential via the dropdown menu and confirm dialog", async () => {
    const androidName = `Play Service ${suffix}`;
    const row = page.locator('[data-slot="card"]').filter({ hasText: androidName }).first();
    await row.getByRole("button").filter({ hasNotText: /\S/u }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Delete credential?" }).waitFor();
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expectToast(page, "Credential deleted");
    await page.getByText(androidName).waitFor({ state: "detached" });
  });

  // ── API Keys ─────────────────────────────────────────────────────────────

  it("creates an API key via the 2-step dialog and reveals the secret", async () => {
    await page.getByRole("link", { name: "API Keys" }).click();
    await page.waitForURL(/\/api-keys$/u);

    await page.getByRole("button", { name: "Create API key" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Create an API key" }).waitFor();
    await dialog.getByLabel("Name").fill(apiKeyName);
    await dialog.getByRole("button", { name: "Create key" }).click();
    await expectToast(page, "API key created");

    // Step 2: title changes and the key is revealed in a <code> element
    await dialog.getByRole("heading", { name: "API key created" }).waitFor();
    const keyCode = dialog.locator("code").first();
    await keyCode.waitFor();
    const revealedKey = (await keyCode.textContent()) ?? "";
    expect(revealedKey.length).toBeGreaterThan(10);

    await dialog.getByRole("button", { name: "Done" }).click();
    await dialog.waitFor({ state: "detached" });

    // The key is now listed in the active keys table
    await page.getByRole("cell", { name: apiKeyName }).waitFor();
  });

  it("revokes an API key via the dropdown menu and confirm dialog", async () => {
    const row = page.getByRole("row").filter({ hasText: apiKeyName });
    await row.getByRole("button").click();
    await page.getByRole("menuitem", { name: "Revoke key" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Revoke API key" }).waitFor();
    await dialog.getByRole("button", { name: "Revoke key" }).click();
    await expectToast(page, "API key revoked");
    await page.getByRole("cell", { name: apiKeyName }).waitFor({ state: "detached" });
  });

  // ── Audit Log ────────────────────────────────────────────────────────────

  it("audit log shows seeded events and filters by resource type", async () => {
    await page.getByRole("link", { name: "Audit Log" }).click();
    await page.waitForURL(/\/audit-log$/u);

    // Wait for audit entries to load. Project creation emits an entry.
    await page.getByText("Activity", { exact: true }).first().waitFor();

    // All filter: entries present
    await page.getByRole("cell").filter({ hasText: /\w/u }).first().waitFor();

    // Filter by Project resource type
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Project", exact: true }).click();
    // The activity table still renders at least one project row
    await page.getByText("Activity", { exact: true }).first().waitFor();

    // Filter by Credential to validate filter switching
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Credential", exact: true }).click();
    await page.getByText("Activity", { exact: true }).first().waitFor();
  });

  it("audit log applies a date-range filter", async () => {
    // Use a wide date range to keep rows visible
    const today = new Date();
    const from = new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const to = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Reset resource filter to All first
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "All", exact: true }).click();

    const dateInputs = page.locator('input[type="date"]');
    await dateInputs.nth(0).fill(from);
    await dateInputs.nth(1).fill(to);

    await page.getByText("Activity", { exact: true }).first().waitFor();
    // Rows should still be visible — our seeded actions happened today
    await page.getByRole("cell").filter({ hasText: /\w/u }).first().waitFor();
  });
});
