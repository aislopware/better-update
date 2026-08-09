import type { BrowserContext, Page } from "playwright";

import {
  createSharedBrowserRuntime,
  E2E_DEFAULT_TIMEOUT_MS,
  gotoTabViaUI,
  loginViaUI,
  shortId,
  uniqueEmail,
  waitForOnboarded,
} from "../helpers/browser-helpers";
import { setupE2EDashboard } from "../helpers/e2e-dashboard";
import { seedUserOrgProject } from "../helpers/web-seeder";

// Env var values are end-to-end encrypted, and the dashboard's mutation surface
// is host-gated to the dedicated vault origin (`isVaultHost()` in
// `lib/env-vault/host.ts`). This suite is served from `127.0.0.1`, which is
// neither `VAULT_HOST` nor a `*.localhost` dev host, so the ordinary dashboard
// origin must render metadata only. The flow seeds an encrypted var directly —
// opaque ciphertext the dashboard never decrypts — then asserts the UI renders
// it and offers no mutation affordance here. The encrypted mutation lifecycle is
// covered by the CLI e2e (apps/cli/tests/e2e/env-commands.test.ts) and the
// API-level read-only flow by tests/e2e/env-vars-flow.test.ts.

const dashboard = setupE2EDashboard();
const runtime = createSharedBrowserRuntime();

const suffix = shortId();
const ownerEmail = uniqueEmail("env-vars");
const projectName = `Env Vars Project ${suffix}`;
const slug = `env-vars-${suffix}`;
const envKey = `EXPO_PUBLIC_API_URL_${suffix.toUpperCase()}`;

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

  // Seed one encrypted project env var with a single revision. The ciphertext /
  // wrapped DEK are opaque placeholders — the dashboard reads metadata only.
  //
  // Seeded here rather than in the test body: `env_vars` is unique on
  // (project_id, key, environment), and `--retry` re-runs the body but not this
  // hook, so a body-level INSERT turns the first failure into a constraint
  // violation that buries it.
  await dashboard.seedSql(`
INSERT INTO "env_vars"
  ("id","organization_id","project_id","scope","environment","key","visibility","current_revision_id","created_at","updated_at")
VALUES
  ('ev-browser-${suffix}','${orgId}','${projectId}','project','production','${envKey}','plaintext','rev-browser-${suffix}','2024-02-01T00:00:00Z','2024-02-01T00:00:00Z');

INSERT INTO "env_var_revisions"
  ("id","env_var_id","organization_id","revision_number","value_ciphertext","wrapped_dek","vault_version","created_by_user_id","created_at","updated_at")
VALUES
  ('rev-browser-${suffix}','ev-browser-${suffix}','${orgId}',1,'ciphertext-browser','wrapped-dek-browser',1,NULL,'2024-02-01T00:00:00Z','2024-02-01T00:00:00Z');
`);

  context = await runtime.getBrowser().newContext();
  page = await context.newPage();
  page.setDefaultTimeout(E2E_DEFAULT_TIMEOUT_MS);
  await loginViaUI(page, dashboard.getBaseUrl(), { email: ownerEmail });
  await waitForOnboarded(page);
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
  it("shows seeded env vars read-only off the vault origin", async () => {
    await gotoTabViaUI(page, "Env Variables");

    // The seeded variable renders as a metadata row… (`.first()`: the row's
    // trailing actions cell is named "Actions for <key>", so the key matches
    // two cells)
    await page.getByRole("cell", { name: envKey }).first().waitFor();
    // …the section header says where values come from…
    await page
      .getByText(/set from the CLI/iu)
      .first()
      .waitFor();
    // …and this origin offers no env-var mutation affordances.
    await expect(page.getByRole("button", { name: "Add variable" }).count()).resolves.toBe(0);
    await expect(page.getByRole("button", { name: "Import .env" }).count()).resolves.toBe(0);
  });
});
