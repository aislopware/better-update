import { useRouterState } from "@tanstack/react-router";

const APP_NAME = "Better Update";

const ORG_LABELS: Record<string, string> = {
  projects: "Projects",
  members: "Members",
  "audit-log": "Audit log",
  credentials: "Credentials",
  "apple-devices": "Apple Devices",
  "api-keys": "API Keys",
  settings: "Organization settings",
  account: "Account",
  onboarding: "Onboarding",
};

const PROJECT_SECTION_LABELS: Record<string, string> = {
  "audit-log": "Audit log",
  builds: "Builds",
  channels: "Channels",
  branches: "Branches",
  updates: "Updates",
  settings: "Project settings",
  "environment-variables": "Environment variables",
  credentials: "Credentials",
};

const PROJECT_SLUG_ROUTE_ID = "/_authed/_app/projects/$projectSlug";

interface RouteMatch {
  readonly routeId: string;
  readonly context: unknown;
}

const hasProjectName = (value: unknown): value is { project: { name: string } } => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { project } = value as { project?: unknown };
  if (typeof project !== "object" || project === null) {
    return false;
  }
  const { name } = project as { name?: unknown };
  return typeof name === "string";
};

const readProjectName = (matches: readonly RouteMatch[]) => {
  const match = matches.find((entry) => entry.routeId === PROJECT_SLUG_ROUTE_ID);
  if (!match) {
    return undefined;
  }
  return hasProjectName(match.context) ? match.context.project.name : undefined;
};

const derivePageLabel = (pathname: string, matches: readonly RouteMatch[]) => {
  const segments = pathname.split("/").filter(Boolean);
  const [first, second, third] = segments;

  if (!first) {
    return undefined;
  }

  if (first === "projects" && second) {
    if (third) {
      return PROJECT_SECTION_LABELS[third] ?? third;
    }
    return readProjectName(matches) ?? second;
  }

  if (first === "settings" && second) {
    return ORG_LABELS[second] ?? second;
  }

  return ORG_LABELS[first] ?? first;
};

export const DocumentTitle = () => {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const matches = useRouterState({
    select: (state) => state.matches as readonly RouteMatch[],
  });
  const label = derivePageLabel(pathname, matches);
  const title = label ? `${label} - ${APP_NAME}` : APP_NAME;
  return <title>{title}</title>;
};
