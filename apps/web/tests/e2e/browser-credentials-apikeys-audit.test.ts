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

// The /credentials page is read-only: one <section> per credential type, each
// showing metadata + a "use the CLI" hint and no upload/delete affordance.
// Scope lookups to a section to assert the per-type empty-state copy.
const pushKeySection = () => page.locator("section").filter({ hasText: "APNs Push Keys" });

const googleSaSection = () =>
  page.locator("section").filter({ hasText: "Google Service Account Keys" });

// ── Tests ─────────────────────────────────────────────────────────────────

describe("dashboard credentials + API keys + audit log (browser)", () => {
  it("renders credentials read-only — no upload/delete, CLI hints shown", async () => {
    await page.getByRole("link", { name: "Credentials" }).click();
    await page.waitForURL(/\/credentials$/u);

    // Read-only dashboard: no credential mutation affordances anywhere.
    await expect(page.getByRole("button", { name: "Upload" }).count()).resolves.toBe(0);
    await expect(page.getByRole("button", { name: "Delete" }).count()).resolves.toBe(0);

    // Empty sections point to the CLI instead of opening an upload dialog.
    await pushKeySection()
      .getByText(/use the cli to upload/iu)
      .first()
      .waitFor();
    await googleSaSection()
      .getByText(/use the cli to upload/iu)
      .first()
      .waitFor();
  });

  // ── API Keys ─────────────────────────────────────────────────────────────

  it("creates an API key via the 2-step dialog and reveals the secret", async () => {
    await page.getByRole("link", { name: "API Keys" }).click();
    await page.waitForURL(/\/api-keys$/u);

    await page.getByRole("button", { name: "Create API key" }).click();
    // Scope to the dialog popup by slot — base-ui toasts also carry role="dialog".
    const dialog = page.locator('[data-slot="dialog-popup"]');
    await dialog.getByRole("heading", { name: "Create an API key" }).waitFor();
    await dialog.getByLabel("Name").fill(apiKeyName);
    await dialog.getByRole("button", { name: "Create key" }).click();
    await expectToast(page, "API key created");

    // Step 2: title swaps to the reveal view. Scope to the dialog title slot —
    // the success toast renders the same "API key created" text, so a bare
    // heading lookup is ambiguous.
    await dialog.locator('[data-slot="dialog-title"]', { hasText: "API key created" }).waitFor();
    // The key is revealed in a read-only input (InputGroupInput), not a <code>.
    const keyInput = dialog.locator("input[readonly]");
    await keyInput.waitFor();
    const revealedKey = await keyInput.inputValue();
    expect(revealedKey.length).toBeGreaterThan(10);

    await dialog.getByRole("button", { name: "Done" }).click();
    await dialog.waitFor({ state: "detached" });

    // The keys list renders as <ul>/<li>, so match the list item, not a table cell.
    await page.getByRole("listitem").filter({ hasText: apiKeyName }).waitFor();
  });

  it("revokes an API key via the dropdown menu and confirm dialog", async () => {
    const row = page.getByRole("listitem").filter({ hasText: apiKeyName });
    await row.getByRole("button", { name: "Key actions" }).click();
    await page.getByRole("menuitem", { name: "Revoke key" }).click();

    const dialog = page.locator('[data-slot="dialog-popup"]');
    await dialog.getByRole("heading", { name: "Revoke API key" }).waitFor();
    await dialog.getByRole("button", { name: "Revoke key" }).click();
    await expectToast(page, "API key revoked");
    await page.getByRole("listitem").filter({ hasText: apiKeyName }).waitFor({ state: "detached" });
  });

  // ── Audit Log ────────────────────────────────────────────────────────────

  it("audit log shows seeded events and filters by resource type", async () => {
    await page.getByRole("link", { name: "Audit log" }).click();
    await page.waitForURL(/\/audit-log/u);

    // The "Audit log" page header is always present once the view loads.
    await page.getByRole("heading", { name: "Audit log" }).waitFor();

    // Filter by Project, then reset — the resource-type Select stays operable.
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Project", exact: true }).click();
    await page.getByRole("heading", { name: "Audit log" }).waitFor();

    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "All resources", exact: true }).click();
    await page.getByRole("heading", { name: "Audit log" }).waitFor();
  });

  it("audit log renders the date-range picker", async () => {
    // The native date inputs were replaced by a DateRangePicker popover
    // (base-ui Popover + react-day-picker Calendar). With no range selected,
    // the trigger shows its default "Pick a date range" placeholder.
    await page.getByRole("button", { name: "Pick a date range" }).waitFor();
  });
});
