import { DEFAULT_PASSWORD } from "./browser-helpers";

import type { setupE2EDashboard } from "./e2e-dashboard";

type Dashboard = ReturnType<typeof setupE2EDashboard>;

const parseSetCookie = (response: Response): string => {
  const setCookie = response.headers.getSetCookie();
  return setCookie
    .map((cookie) => cookie.split(";")[0] ?? "")
    .filter(Boolean)
    .join("; ");
};

export interface SeededOrg {
  readonly cookies: string;
  readonly userEmail: string;
  readonly orgId: string;
  readonly projectId: string;
  readonly slug: string;
}

export interface CreateDashboardSeederParams {
  readonly dashboard: Dashboard;
  readonly name: string;
  readonly email: string;
  readonly orgName: string;
  readonly orgSlug: string;
  readonly projectName: string;
  readonly slug: string;
}

export const seedUserOrgProject = async (
  params: CreateDashboardSeederParams,
): Promise<SeededOrg> => {
  const { dashboard } = params;

  const signupResponse = await dashboard.post("/api/auth/sign-up/email", {
    name: params.name,
    email: params.email,
    password: DEFAULT_PASSWORD,
  });
  expect(signupResponse.status).toBe(200);
  let cookies = parseSetCookie(signupResponse);

  const createOrgResponse = await dashboard.post(
    "/api/auth/organization/create",
    { name: params.orgName, slug: params.orgSlug },
    { cookie: cookies },
  );
  expect(createOrgResponse.status).toBe(200);
  const orgBody = (await createOrgResponse.json()) as { id: string };
  cookies = parseSetCookie(createOrgResponse) || cookies;

  const setActiveResponse = await dashboard.post(
    "/api/auth/organization/set-active",
    { organizationId: orgBody.id },
    { cookie: cookies },
  );
  expect(setActiveResponse.status).toBe(200);
  cookies = parseSetCookie(setActiveResponse) || cookies;

  const projectResponse = await dashboard.post(
    "/api/projects",
    { name: params.projectName, slug: params.slug },
    { cookie: cookies },
  );
  expect(projectResponse.status).toBe(201);
  const projectBody = (await projectResponse.json()) as { id: string };

  return {
    cookies,
    userEmail: params.email,
    orgId: orgBody.id,
    projectId: projectBody.id,
    slug: params.slug,
  };
};
