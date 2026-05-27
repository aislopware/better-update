import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@better-update/ui/components/ui/breadcrumb";
import { Link, useRouterState } from "@tanstack/react-router";
import { Suspense } from "react";

import { ProjectSwitcher } from "./-project-switcher";

const ROUTE_LABELS: Record<string, string> = {
  projects: "Projects",
  "audit-log": "Audit log",
  members: "Members",
  credentials: "Credentials",
  "vault-access": "Vault access",
  "api-keys": "API Keys",
  settings: "Organization settings",
  account: "Account",
  onboarding: "Onboarding",
  builds: "Builds",
  channels: "Channels",
  branches: "Branches",
  updates: "Updates",
  runtimes: "Runtimes",
  submissions: "Submissions",
  "apple-devices": "Apple Devices",
  "environment-variables": "Environment variables",
};

const switcherFallback = <span className="text-muted-foreground">Loading...</span>;

const OrgCrumb = ({ orgName }: { orgName: string }) => (
  <BreadcrumbItem>
    <BreadcrumbLink render={<Link to="/projects" />}>{orgName}</BreadcrumbLink>
  </BreadcrumbItem>
);

interface AppBreadcrumbProps {
  readonly orgId: string;
  readonly orgName: string;
  readonly projectSlug: string | undefined;
}

export const AppBreadcrumb = ({ orgId, orgName, projectSlug }: AppBreadcrumbProps) => {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const segments = pathname.split("/").filter(Boolean);
  const [first, , third] = segments;

  if (projectSlug && first === "projects") {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <OrgCrumb orgName={orgName} />
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <Suspense fallback={switcherFallback}>
              <ProjectSwitcher orgId={orgId} currentProjectSlug={projectSlug} />
            </Suspense>
          </BreadcrumbItem>
          {third ? (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{ROUTE_LABELS[third] ?? third}</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          ) : null}
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  if (!first) {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <OrgCrumb orgName={orgName} />
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <OrgCrumb orgName={orgName} />
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{ROUTE_LABELS[first] ?? first}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
};
