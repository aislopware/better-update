import {
  DEFAULT_PASSWORD,
  completeOnboardingViaUI,
  createSharedBrowserRuntime,
  expectToast,
  loginViaUI,
  logoutViaUI,
  shortId,
  signUpViaUI,
  toSlug,
  uniqueEmail,
} from "../helpers/browser-helpers";
import { setupE2EDashboard } from "../helpers/e2e-dashboard";

const dashboard = setupE2EDashboard();
const runtime = createSharedBrowserRuntime();

beforeAll(async () => {
  await runtime.setup();
});

afterAll(async () => {
  await runtime.teardown();
});

// ── API seeding helpers ───────────────────────────────────────────────────

const parseSetCookie = (response: Response): string => {
  const setCookie = response.headers.getSetCookie();
  return setCookie
    .map((cookie) => cookie.split(";")[0] ?? "")
    .filter(Boolean)
    .join("; ");
};

const signUpApi = async (params: {
  readonly name: string;
  readonly email: string;
}): Promise<{ readonly cookies: string }> => {
  const response = await dashboard.post("/api/auth/sign-up/email", {
    name: params.name,
    email: params.email,
    password: DEFAULT_PASSWORD,
  });
  expect(response.status).toBe(200);
  return { cookies: parseSetCookie(response) };
};

const createOrgApi = async (params: {
  readonly cookies: string;
  readonly name: string;
  readonly slug: string;
}): Promise<{ readonly cookies: string; readonly orgId: string }> => {
  const response = await dashboard.post(
    "/api/auth/organization/create",
    { name: params.name, slug: params.slug },
    { cookie: params.cookies },
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { id: string };
  return {
    cookies: parseSetCookie(response) || params.cookies,
    orgId: body.id,
  };
};

const setActiveOrgApi = async (params: {
  readonly cookies: string;
  readonly orgId: string;
}): Promise<string> => {
  const response = await dashboard.post(
    "/api/auth/organization/set-active",
    { organizationId: params.orgId },
    { cookie: params.cookies },
  );
  expect(response.status).toBe(200);
  return parseSetCookie(response) || params.cookies;
};

const inviteMemberApi = async (params: {
  readonly cookies: string;
  readonly email: string;
  readonly role: "member" | "admin";
  readonly organizationId: string;
}): Promise<string> => {
  const response = await dashboard.post(
    "/api/auth/organization/invite-member",
    {
      email: params.email,
      role: params.role,
      organizationId: params.organizationId,
    },
    { cookie: params.cookies },
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { id: string };
  return body.id;
};

const acceptInvitationApi = async (params: {
  readonly cookies: string;
  readonly invitationId: string;
}): Promise<void> => {
  const response = await dashboard.post(
    "/api/auth/organization/accept-invitation",
    { invitationId: params.invitationId },
    { cookie: params.cookies },
  );
  expect(response.status).toBe(200);
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe("dashboard auth + org + account (browser)", () => {
  it("signup form + onboarding + logout + login round-trip", async () => {
    await runtime.withPage(async (page) => {
      const suffix = shortId();
      const user = {
        name: `Round Trip ${suffix}`,
        email: `round-trip-${suffix}@example.com`,
      };

      await signUpViaUI(page, dashboard.getBaseUrl(), user);
      await completeOnboardingViaUI(page, {
        organizationName: `Round Trip Org ${suffix}`,
        organizationSlug: `round-trip-${suffix}`,
      });

      // On /projects after onboarding
      await page.getByRole("button", { name: "Create project" }).first().waitFor();

      await logoutViaUI(page, user.name);

      // Re-login with the same credentials
      await loginViaUI(page, dashboard.getBaseUrl(), { email: user.email });
      await page.waitForURL(/\/projects(?:$|\/|\?)/u);
      await page.getByRole("button", { name: "Create project" }).first().waitFor();
    });
  });

  it("create additional organization from sidebar and switch active org", async () => {
    await runtime.withPage(async (page) => {
      const suffix = shortId();
      const user = {
        name: `Switcher ${suffix}`,
        email: uniqueEmail("switcher"),
      };
      const firstOrg = {
        name: `Primary ${suffix}`,
        slug: `primary-${suffix}`,
      };
      const secondOrg = {
        name: `Secondary ${suffix}`,
        slug: `secondary-${suffix}`,
      };

      await signUpViaUI(page, dashboard.getBaseUrl(), user);
      await completeOnboardingViaUI(page, {
        organizationName: firstOrg.name,
        organizationSlug: firstOrg.slug,
      });

      // Open OrgSwitcher (sidebar org button) and create a new org
      await page
        .getByRole("button", { name: new RegExp(firstOrg.name, "u") })
        .first()
        .click();
      await page.getByRole("menuitem", { name: "Create organization" }).click();

      const createOrgDialog = page.getByRole("dialog");
      await createOrgDialog.getByLabel("Organization name").fill(secondOrg.name);
      await createOrgDialog.getByLabel("URL slug").fill(secondOrg.slug);
      await createOrgDialog.getByRole("button", { name: "Create organization" }).click();

      // After creation the dialog closes and the sidebar shows the new org name
      await page
        .getByRole("button", { name: new RegExp(secondOrg.name, "u") })
        .first()
        .waitFor();

      // Switch back to the primary org via the switcher menu
      await page
        .getByRole("button", { name: new RegExp(secondOrg.name, "u") })
        .first()
        .click();
      await page.getByRole("menuitem", { name: new RegExp(firstOrg.name, "u") }).click();
      await page
        .getByRole("button", { name: new RegExp(firstOrg.name, "u") })
        .first()
        .waitFor();
    });
  });

  it("invite member, cancel pending invitation", async () => {
    await runtime.withPage(async (page) => {
      const suffix = shortId();
      const owner = {
        name: `Inviter ${suffix}`,
        email: uniqueEmail("inviter"),
      };
      const invitee = uniqueEmail("invitee");

      await signUpViaUI(page, dashboard.getBaseUrl(), owner);
      await completeOnboardingViaUI(page, {
        organizationName: `Invite Org ${suffix}`,
        organizationSlug: `invite-${suffix}`,
      });

      await page.getByRole("link", { name: "Members" }).click();
      await page.waitForURL(/\/members$/u);

      // Invite dialog
      await page.getByRole("button", { name: "Invite member" }).click();
      const inviteDialog = page.getByRole("dialog");
      await inviteDialog.getByLabel("Email address").fill(invitee);
      await inviteDialog.getByRole("button", { name: "Admin" }).click();
      await inviteDialog.getByRole("button", { name: "Send invitation" }).click();
      await expectToast(page, "Invitation sent");

      // Pending invitations card shows the new row
      await page.getByText("Pending invitations").first().waitFor();
      await page.getByRole("cell", { name: invitee }).waitFor();

      // Cancel the invitation via the ghost icon button on that row
      const invitationRow = page.getByRole("row").filter({ hasText: invitee });
      await invitationRow.getByRole("button").click();
      await expectToast(page, "Invitation canceled");
    });
  });

  it("change role and remove member (seeded via API)", async () => {
    const suffix = shortId();
    const owner = {
      name: `Owner ${suffix}`,
      email: uniqueEmail("owner"),
    };
    const member = {
      name: `Member ${suffix}`,
      email: uniqueEmail("member"),
    };
    const orgName = `Manage Org ${suffix}`;
    const orgSlug = `manage-${suffix}`;

    // Seed via API: create both users, org, invite, accept
    const memberAuth = await signUpApi({ name: member.name, email: member.email });
    const ownerAuth = await signUpApi({ name: owner.name, email: owner.email });
    const ownerOrg = await createOrgApi({
      cookies: ownerAuth.cookies,
      name: orgName,
      slug: orgSlug,
    });
    const ownerCookies = await setActiveOrgApi({
      cookies: ownerOrg.cookies,
      orgId: ownerOrg.orgId,
    });
    const invitationId = await inviteMemberApi({
      cookies: ownerCookies,
      email: member.email,
      role: "member",
      organizationId: ownerOrg.orgId,
    });
    await acceptInvitationApi({
      cookies: memberAuth.cookies,
      invitationId,
    });

    await runtime.withPage(async (page) => {
      await loginViaUI(page, dashboard.getBaseUrl(), { email: owner.email });
      await page.waitForURL(/\/projects(?:$|\/|\?)/u);

      await page.getByRole("link", { name: "Members" }).click();
      await page.waitForURL(/\/members$/u);

      // Confirm the seeded member is present
      const memberRow = page.getByRole("row").filter({ hasText: member.email });
      await memberRow.waitFor();

      // Open the row action menu and promote to admin
      await memberRow.getByRole("button").click();
      await page.getByRole("menuitem", { name: "Set as Admin" }).click();
      await expectToast(page, "Role updated");

      // Demote back to member
      await memberRow.getByRole("button").click();
      await page.getByRole("menuitem", { name: "Set as Member" }).click();
      await expectToast(page, "Role updated");

      // Remove member
      await memberRow.getByRole("button").click();
      await page.getByRole("menuitem", { name: "Remove member" }).click();
      await page.getByRole("button", { name: "Remove", exact: true }).click();
      await expectToast(page, "Member removed");

      // The member row should disappear
      await memberRow.waitFor({ state: "detached" });
    });
  });

  it("rename organization from settings", async () => {
    await runtime.withPage(async (page) => {
      const suffix = shortId();
      const user = {
        name: `Settings ${suffix}`,
        email: uniqueEmail("settings"),
      };
      const originalOrg = `Settings Org ${suffix}`;
      const renamedOrg = `Renamed Org ${suffix}`;
      const renamedSlug = toSlug(renamedOrg);

      await signUpViaUI(page, dashboard.getBaseUrl(), user);
      await completeOnboardingViaUI(page, {
        organizationName: originalOrg,
        organizationSlug: toSlug(originalOrg),
      });

      await page.getByRole("link", { name: "Organization settings" }).click();
      await page.waitForURL(/\/settings$/u);

      await page.getByLabel("Organization name").fill(renamedOrg);
      await page.getByLabel("URL slug").fill(renamedSlug);
      await page.getByRole("button", { name: "Save changes" }).click();
      await expectToast(page, "Organization updated");

      await page
        .getByRole("button", { name: new RegExp(renamedOrg, "u") })
        .first()
        .waitFor();
    });
  });

  it("update profile name, change password, revoke other sessions", async () => {
    const suffix = shortId();
    const user = {
      name: `Account ${suffix}`,
      email: uniqueEmail("account"),
    };

    // Seed a second session for the same user via API so there is something to revoke
    await signUpApi({ name: user.name, email: user.email });

    await runtime.withPage(async (page) => {
      await loginViaUI(page, dashboard.getBaseUrl(), { email: user.email });
      // Because this user has no org yet, login goes to /onboarding
      await completeOnboardingViaUI(page, {
        organizationName: `Acc Org ${suffix}`,
        organizationSlug: `acc-${suffix}`,
      });

      await page
        .getByRole("button", { name: new RegExp(user.name, "u") })
        .first()
        .click();
      await page.getByRole("menuitem", { name: "Account" }).click();
      await page.waitForURL(/\/account$/u);

      // Profile rename
      const newName = `Renamed ${suffix}`;
      const nameInput = page.getByLabel("Name");
      await nameInput.fill(newName);
      await page.getByRole("button", { name: "Save changes" }).click();
      await expectToast(page, "Profile updated");

      // Password change
      const newPassword = `NewP@ssword${suffix}`;
      await page.getByLabel("Current password").fill(DEFAULT_PASSWORD);
      await page.getByLabel("New password", { exact: true }).fill(newPassword);
      await page.getByLabel("Confirm new password").fill(newPassword);
      await page.getByRole("button", { name: "Change password" }).click();
      await expectToast(page, "Password changed");

      // Revoke all other sessions (the seeded extra session exists in DB)
      await page.getByRole("button", { name: "Revoke all other sessions" }).click();
      await expectToast(page, /revoked/iu);
    });
  });
});
