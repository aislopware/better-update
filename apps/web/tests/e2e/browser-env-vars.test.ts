import type { BrowserContext, Page } from "playwright";

import {
  createSharedBrowserRuntime,
  E2E_DEFAULT_TIMEOUT_MS,
  gotoTabViaUI,
  loginViaUI,
  shortId,
  uniqueEmail,
} from "../helpers/browser-helpers";
import { setupE2EDashboard } from "../helpers/e2e-dashboard";
import { seedUserOrgProject } from "../helpers/web-seeder";

// Env var values are end-to-end encrypted and mutated only through the CLI; the
// dashboard renders metadata READ-ONLY (see `-env-var-row.tsx`: "Read-only … only
// readable via the CLI"). This browser flow seeds an encrypted var directly —
// opaque ciphertext the dashboard never decrypts — then asserts the UI renders it
// and offers no mutation affordance. The encrypted mutation lifecycle is covered
// by the CLI e2e (apps/cli/tests/e2e/env-commands.test.ts) and the API-level
// read-only flow by tests/e2e/env-vars-flow.test.ts.

const dashboard = setupE2EDashboard();
const runtime = createSharedBrowserRuntime();

const suffix = shortId();
const ownerEmail = uniqueEmail("env-vars");
const projectName = `Env Vars Project ${suffix}`;
const slug = `env-vars-${suffix}`;

let context: BrowserContext;
let page: Page;
let orgId: string;
let projectId: string;

beforeAll(async () => {
  await runtime.setup();

  const seeded = await seedUserOrgProject({
    dashboard,
    name: `Env Vars ${suffix}`,
    email: ownerEmail,
    orgName: `Env Vars Org ${suffix}`,
    orgSlug: `env-vars-${suffix}`,
    projectName,
    slug,
  });
  ({ orgId, projectId } = seeded);

  context = await runtime.getBrowser().newContext();
  page = await context.newPage();
  page.setDefaultTimeout(E2E_DEFAULT_TIMEOUT_MS);
  await loginViaUI(page, dashboard.getBaseUrl(), { email: ownerEmail });
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

describe("dashboard environment variables (browser, read-only)", () => {
  it("shows seeded env vars read-only (managed from the CLI)", async () => {
    const envKey = `EXPO_PUBLIC_API_URL_${suffix.toUpperCase()}`;
    // Seed one encrypted project env var with a single revision. The ciphertext /
    // wrapped DEK are opaque placeholders — the dashboard reads metadata only.
    dashboard.seedSql(`
INSERT INTO "env_vars"
  ("id","organization_id","project_id","scope","environment","key","visibility","current_revision_id","created_at","updated_at")
VALUES
  ('ev-browser-${suffix}','${orgId}','${projectId}','project','production','${envKey}','plaintext','rev-browser-${suffix}','2024-02-01T00:00:00Z','2024-02-01T00:00:00Z');

INSERT INTO "env_var_revisions"
  ("id","env_var_id","organization_id","revision_number","value_ciphertext","wrapped_dek","vault_version","created_by_user_id","created_at","updated_at")
VALUES
  ('rev-browser-${suffix}','ev-browser-${suffix}','${orgId}',1,'ciphertext-browser','wrapped-dek-browser',1,NULL,'2024-02-01T00:00:00Z','2024-02-01T00:00:00Z');
`);

    await gotoTabViaUI(page, "Env Variables");

    // The seeded variable renders as a metadata row…
    await page.getByRole("cell", { name: envKey }).waitFor();
    // …the managed-from-CLI read-only notice is shown…
    await page
      .getByText(/managed from the CLI/iu)
      .first()
      .waitFor();
    // …and the dashboard offers no env-var mutation affordances.
    await expect(page.getByRole("button", { name: "Add variable" }).count()).resolves.toBe(0);
    await expect(page.getByRole("button", { name: "Import .env" }).count()).resolves.toBe(0);
  });
});
