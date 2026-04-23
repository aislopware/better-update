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

// Server-side validators parse these; the PEM matches the fixture used in
// Apple-push-key-validator.test.ts so pemToPkcs8Der succeeds.
const PUSH_KEY_ID = "ABCDE12345";
const PUSH_TEAM_ID = "FGHIJ67890";
const PUSH_KEY_PEM = [
  "-----BEGIN PRIVATE KEY-----",
  "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgqIOEeXH1hSPYy+1c",
  "-----END PRIVATE KEY-----",
].join("\n");

const SA_PROJECT_ID = `sa-project-${suffix}`;
const SA_CLIENT_EMAIL = `sa-${suffix}@test.iam.gserviceaccount.com`;
const SA_PRIVATE_KEY_ID = `pkid-${suffix}`;
const SA_JSON = JSON.stringify({
  type: "service_account",
  project_id: SA_PROJECT_ID,
  private_key_id: SA_PRIVATE_KEY_ID,
  private_key: PUSH_KEY_PEM,
  client_email: SA_CLIENT_EMAIL,
});

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

  // Seed an audit-log entry so the audit log tests have non-empty data.
  await createProjectViaUI(page, { name: projectName, slug });
});

afterAll(async () => {
  await context.close();
  await runtime.teardown();
});

// ── Helpers ────────────────────────────────────────────────────────────────

// The /credentials page renders one <section> per credential type, each with
// Its own Upload dialog. Scope lookups to a section to disambiguate multiple
// "Upload" buttons and "Delete" icon buttons on the page.
const pushKeySection = () => page.locator("section").filter({ hasText: "APNs Push Keys" });

const googleSaSection = () =>
  page.locator("section").filter({ hasText: "Google Service Account Keys" });

// ── Tests ─────────────────────────────────────────────────────────────────

describe("dashboard credentials + API keys + audit log (browser)", () => {
  it("uploads an APNs push key via the per-platform dialog", async () => {
    await page.getByRole("link", { name: "Credentials" }).click();
    await page.waitForURL(/\/credentials$/u);

    await pushKeySection().getByRole("button", { name: "Upload" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Upload APNs Push Key" }).waitFor();

    await dialog.getByLabel("Key ID").fill(PUSH_KEY_ID);
    await dialog.getByLabel("Apple Team ID").fill(PUSH_TEAM_ID);

    const fileInput = dialog.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "push-key.p8",
      mimeType: "application/x-pem-file",
      buffer: Buffer.from(PUSH_KEY_PEM),
    });

    await dialog.getByRole("button", { name: "Upload", exact: true }).click();
    await expectToast(page, "Push key uploaded");
    await pushKeySection().getByText(PUSH_KEY_ID).waitFor();
  });

  it("uploads a Google service-account key via the per-platform dialog", async () => {
    await googleSaSection().getByRole("button", { name: "Upload" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Upload Google Service Account Key" }).waitFor();

    const fileInput = dialog.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "service-account.json",
      mimeType: "application/json",
      buffer: Buffer.from(SA_JSON),
    });

    await dialog.getByRole("button", { name: "Upload", exact: true }).click();
    await expectToast(page, "Service account key uploaded");
    await googleSaSection().getByText(SA_CLIENT_EMAIL).waitFor();
  });

  it("deletes the Google service-account key via confirm dialog", async () => {
    const row = googleSaSection().getByRole("row").filter({ hasText: SA_CLIENT_EMAIL });
    await row.getByRole("button", { name: "Delete" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Delete service account key?" }).waitFor();
    // ConfirmDeleteDialog requires typing the `name` prop, which for Google
    // SA keys is the first 8 chars of privateKeyId.
    await dialog.getByLabel(/type.*to confirm/iu).fill(SA_PRIVATE_KEY_ID.slice(0, 8));
    await dialog.getByRole("button", { name: "Delete permanently" }).click();
    await expectToast(page, "Service account key deleted");
    await googleSaSection().getByText(SA_CLIENT_EMAIL).waitFor({ state: "detached" });
  });

  it("deletes the APNs push key via confirm dialog", async () => {
    const row = pushKeySection().getByRole("row").filter({ hasText: PUSH_KEY_ID });
    await row.getByRole("button", { name: "Delete" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Delete push key?" }).waitFor();
    await dialog.getByLabel(/type.*to confirm/iu).fill(PUSH_KEY_ID);
    await dialog.getByRole("button", { name: "Delete permanently" }).click();
    await expectToast(page, "Push key deleted");
    await pushKeySection().getByText(PUSH_KEY_ID).waitFor({ state: "detached" });
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
    await page.getByRole("link", { name: "Audit log" }).click();
    await page.waitForURL(/\/audit-log$/u);

    // Project creation in beforeAll emits at least one audit entry, so the
    // Activity card renders (the empty state is shown when items.length === 0).
    await page.getByText("Activity", { exact: true }).first().waitFor();

    // Filter by Project — same entry still matches.
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Project", exact: true }).click();
    await page.getByText("Activity", { exact: true }).first().waitFor();

    // Reset filter back to All.
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "All", exact: true }).click();
    await page.getByText("Activity", { exact: true }).first().waitFor();
  });

  it("audit log renders the date-range picker", async () => {
    // The native date inputs were replaced by a DateRangePicker popover
    // (base-ui Popover + react-day-picker Calendar). Verify the trigger
    // Renders — detailed calendar interaction is out of scope for e2e.
    await page.getByRole("button", { name: "Date range" }).waitFor();
  });
});
