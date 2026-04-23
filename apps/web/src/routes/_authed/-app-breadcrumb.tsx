import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import { Suspense } from "react";

import { ProjectSwitcher } from "./-project-switcher";

const ROUTE_LABELS: Record<string, string> = {
  projects: "Projects",
  "audit-log": "Audit log",
  members: "Members",
  credentials: "Credentials",
  "api-keys": "API Keys",
  settings: "Organization settings",
  account: "Account",
  onboarding: "Onboarding",
  builds: "Builds",
  channels: "Channels",
  branches: "Branches",
  updates: "Updates",
  "environment-variables": "Environment variables",
};

const Separator = () => (
  <ChevronRightIcon strokeWidth={2} className="text-muted-foreground size-3.5" />
);

const TextCrumb = ({ label }: { label: string }) => <span className="font-medium">{label}</span>;

const switcherFallback = <span className="text-muted-foreground">Loading...</span>;

const OrgCrumb = ({ orgName }: { orgName: string }) => (
  <Link
    to="/projects"
    className="text-muted-foreground hover:text-foreground truncate font-medium transition-colors"
  >
    {orgName}
  </Link>
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
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
        <OrgCrumb orgName={orgName} />
        <Separator />
        <Suspense fallback={switcherFallback}>
          <ProjectSwitcher orgId={orgId} currentProjectSlug={projectSlug} />
        </Suspense>
        {third ? (
          <>
            <Separator />
            <TextCrumb label={ROUTE_LABELS[third] ?? third} />
          </>
        ) : null}
      </nav>
    );
  }

  if (!first) {
    return (
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
        <OrgCrumb orgName={orgName} />
      </nav>
    );
  }

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
      <OrgCrumb orgName={orgName} />
      <Separator />
      <TextCrumb label={ROUTE_LABELS[first] ?? first} />
    </nav>
  );
};
