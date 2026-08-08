import { Breadcrumbs } from "@better-update/ui/components/breadcrumbs";
import { useRouterState } from "@tanstack/react-router";

/**
 * Project sections that have a detail page under them. The value is the label;
 * membership of `PROJECT_LIST_SECTIONS` decides whether the crumb links back.
 */
const PROJECT_SECTION_LABELS: Record<string, string> = {
  builds: "Builds",
  channels: "Channels",
  credentials: "Credentials",
  fingerprints: "Fingerprints",
  runtimes: "Runtimes",
  submissions: "Submissions",
  updates: "Updates",
};

// Fingerprints is the exception: a fingerprint page is reachable from a build,
// but the project has no fingerprint list to go back to.
const PROJECT_LIST_SECTIONS = new Set([
  "builds",
  "channels",
  "credentials",
  "runtimes",
  "submissions",
  "updates",
]);

interface Crumb {
  readonly label: string;
  /** Absent for a section with no list page of its own. */
  readonly href?: string;
}

const projectAncestors = (projectSlug: string, rest: readonly string[]): readonly Crumb[] => {
  const [section, ...detail] = rest;
  if (section === undefined || detail.length === 0) {
    return [];
  }
  // Only sections this file can name get a crumb. Every real detail page sits
  // under one of them, so an unnamed section means the address matched nothing —
  // and the trail above a "Page not found" used to spell out the URL that failed
  // ("Storefront iOS › settings"), which reads as a place you could go back to.
  const label = PROJECT_SECTION_LABELS[section];
  if (label === undefined) {
    return [];
  }
  const sectionCrumb: Crumb = PROJECT_LIST_SECTIONS.has(section)
    ? { label, href: `/projects/${projectSlug}/${section}` }
    : { label };
  if (section === "credentials") {
    const [platform, identifier] = detail;
    // `/credentials/ios` is not a page — only the identifier below it is, so the
    // platform reads as a plain step in the path.
    return identifier === undefined
      ? []
      : [sectionCrumb, { label: platform === "ios" ? "iOS" : "Android" }];
  }
  return [sectionCrumb];
};

const orgAncestors = (segments: readonly string[]): readonly Crumb[] => {
  const [first, second] = segments;
  return first === "account" && second !== undefined
    ? [{ label: "Account", href: "/account" }]
    : [];
};

/**
 * The trail *above* the current page, rendered after the ProjectSwitcher (which
 * is the root crumb). The page itself is not in it: every page states its own
 * name in its `<h1>`, and repeating that name a line above turns the header into
 * an echo — "All Projects › Projects" over a page titled "Projects".
 *
 * So most pages contribute nothing here and the header stays quiet, which is how
 * the Cloudflare dashboard reads; only a detail page hands back the section it
 * came from.
 *
 * Hidden below `md`, where the ProjectSwitcher alone carries the location.
 */
export const HeaderBreadcrumbs = ({ projectSlug }: { projectSlug: string | undefined }) => {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const segments = pathname.split("/").filter(Boolean);
  const crumbs =
    projectSlug && segments[0] === "projects"
      ? projectAncestors(projectSlug, segments.slice(2))
      : orgAncestors(segments);

  if (crumbs.length === 0) {
    return null;
  }

  return (
    <Breadcrumbs size="sm" className="hidden min-w-0 md:flex">
      {crumbs.flatMap((crumb, index) => [
        <Breadcrumbs.Separator key={`separator-${crumb.label}-${String(index)}`} />,
        crumb.href === undefined ? (
          <span key={`crumb-${crumb.label}`} className="text-kumo-subtle shrink-0">
            {crumb.label}
          </span>
        ) : (
          <Breadcrumbs.Link key={`crumb-${crumb.label}`} href={crumb.href}>
            {crumb.label}
          </Breadcrumbs.Link>
        ),
      ])}
    </Breadcrumbs>
  );
};
