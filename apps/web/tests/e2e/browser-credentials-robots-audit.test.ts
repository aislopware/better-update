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

const robotName = `ci-robot-${suffix}`;
const renamedRobot = `ci-robot-${suffix}-renamed`;

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

// A sidebar link shares its accessible name with the breadcrumb trail once the
// page is open, so a bare role lookup is ambiguous on a retry. The sidebar
// entry comes first in the DOM and is the only clickable one.
const gotoSidebar = async (name: string): Promise<void> => {
  await page.getByRole("link", { name }).first().click();
};

// Robot accounts are minted from the CLI — the age keypair is generated on a
// maintainer's device — so the browser flow seeds one through the API with the
// session the page already holds. The public key below is a fixture standing in
// for that half; nothing here decrypts a vault.
const browserCookieHeader = async (): Promise<string> => {
  const cookies = await context.cookies();
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
};

const seedRobotAccount = async (): Promise<void> => {
  const cookie = await browserCookieHeader();
  const projectsResponse = await dashboard.get("/api/projects", { cookie });
  const { items } = (await projectsResponse.json()) as {
    items: readonly { id: string; slug: string }[];
  };
  const project = items.find((item) => item.slug === slug);
  if (!project) {
    throw new Error(`seedRobotAccount: project "${slug}" not found`);
  }

  const response = await dashboard.post(
    "/api/robot-accounts",
    {
      name: robotName,
      projectId: project.id,
      role: "developer",
      publicKey: `age1e2efixture${suffix}`,
      fingerprint: `SHA256:e2e-fixture-${suffix}`,
    },
    { cookie },
  );
  if (response.status !== 201) {
    throw new Error(`seedRobotAccount failed: ${response.status} ${await response.text()}`);
  }
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe("dashboard credentials + robot accounts + audit log (browser)", () => {
  it("renders credentials read-only — no upload/delete, CLI hints shown", async () => {
    await gotoSidebar("Credentials");
    await page.waitForURL(/\/credentials$/u);

    // Read-only dashboard: no credential mutation affordances anywhere.
    await expect(page.getByRole("button", { name: "Upload" }).count()).resolves.toBe(0);
    await expect(page.getByRole("button", { name: "Delete" }).count()).resolves.toBe(0);

    // Empty sections point to the CLI instead of opening an upload dialog.
    await pushKeySection()
      .getByText(/from the cli/iu)
      .first()
      .waitFor();
    await googleSaSection()
      .getByText(/from the cli/iu)
      .first()
      .waitFor();
  });

  // ── Robot accounts ───────────────────────────────────────────────────────

  it("robot accounts are CLI-only — the empty state hands over the command", async () => {
    await page.goto(`${dashboard.getBaseUrl()}/projects/${slug}/robot-accounts`);

    await page.getByText("No robot accounts yet").waitFor();
    await page.getByText(/credentials robot create/u).waitFor();

    // Minting, rotating and revoking stay on the CLI — the page offers neither.
    await expect(page.getByRole("button", { name: /create robot/iu }).count()).resolves.toBe(0);
    await expect(page.getByRole("button", { name: /revoke/iu }).count()).resolves.toBe(0);
  });

  it("renames a robot account through the row menu dialog", async () => {
    await seedRobotAccount();
    await page.reload();

    await page.getByRole("cell", { name: robotName }).first().waitFor();
    await page.getByRole("button", { name: "Robot account actions" }).first().click();
    await page.getByRole("menuitem", { name: "Edit" }).click();

    // Scope to the dialog content by slot: Base UI toasts also expose
    // role="dialog", so a role lookup could resolve to two.
    const dialog = page.locator('[data-slot="dialog-body"]');
    await dialog.getByRole("heading", { name: "Edit robot account" }).waitFor();
    await dialog.getByLabel("Name").fill(renamedRobot);
    await dialog.getByRole("button", { name: "Save changes" }).click();

    await expectToast(page, "Robot account updated");
    await page.getByRole("cell", { name: renamedRobot }).first().waitFor();
  });

  // ── Audit Log ────────────────────────────────────────────────────────────

  it("audit log shows seeded events and filters by resource type", async () => {
    // Straight to the org route: the preceding test leaves the page inside a
    // project, whose sidebar carries the project nav, not the org's.
    await page.goto(`${dashboard.getBaseUrl()}/audit-log`);

    // The "Audit log" page header is always present once the view loads.
    await page.getByRole("heading", { name: "Audit log" }).waitFor();

    // Filter by Project via the "Resource" faceted-filter chip (Command popover
    // with option items; single-select closes on pick), then clear it again.
    // Anchor the name regex at the start: the chip's accessible name is
    // "Resource" (plus the selected badge, e.g. "Resource Project"), while the
    // per-row copy buttons are "Copy Resource ID" and must not match.
    await page.getByRole("button", { name: /^Resource/u }).click();
    await page.getByRole("option", { name: "Project", exact: true }).click();
    await page.getByRole("heading", { name: "Audit log" }).waitFor();

    // Clear through the toolbar's Reset, which only appears while a filter is
    // set. The popover's own "Clear filters" option is re-created when the
    // filtered query resolves, so clicking it races the re-render.
    await page.getByRole("button", { name: "Reset" }).click();
    await page.getByRole("button", { name: "Reset" }).waitFor({ state: "detached" });
    await page.getByRole("heading", { name: "Audit log" }).waitFor();
  });

  it("audit log renders the date-range picker", async () => {
    // The native date inputs were replaced by a DateRangePicker popover
    // (base-ui Popover + react-day-picker Calendar) rendered as a dashed
    // toolbar filter chip titled "Date range".
    await page.getByRole("button", { name: "Date range" }).waitFor();
  });
});
