import type { ReactElement } from "react";

import { RouterLink } from "../../../lib/resource-link";

/**
 * The audit row's resource, as a way to get to it.
 *
 * "Build upload" over a sixteen-character id is a fact the reader cannot act on:
 * the log names the thing that changed and then leaves them to carry the id to
 * another page by hand. Where the dashboard has a page for that exact thing, the
 * name on the row goes there.
 *
 * Only the project-scoped log can do this. An organization's log spans projects
 * and an entry records no slug, so there is nothing to build a path out of —
 * those rows keep the plain id rather than guessing a project.
 */

// An audit row outlives what it describes. "Build delete" names an id whose page
// is already gone, and a link to a 404 is worse than the id it replaced — the
// row is the last remaining trace of that resource, so it stays plain text.
const DESTRUCTIVE_VERBS = new Set(["archive", "delete", "destroy", "remove", "revoke", "unlink"]);

const resourceIsGone = (action: string): boolean => {
  const verb = action.split(".").at(-1);
  return verb !== undefined && DESTRUCTIVE_VERBS.has(verb);
};

export const AuditResourceLink = ({
  projectSlug,
  resourceType,
  resourceId,
  action,
  className,
  children,
}: {
  readonly projectSlug: string | undefined;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly action: string;
  readonly className?: string;
  /**
   * An element rather than any node: the wrapper hands it back untouched when
   * there is nowhere to go, and `ReactNode` would widen the return type to
   * include the thenable React 19 allows.
   */
  readonly children: ReactElement;
}): ReactElement => {
  if (!projectSlug || !resourceId || resourceIsGone(action)) {
    return children;
  }

  switch (resourceType) {
    case "build": {
      return (
        <RouterLink
          to="/projects/$projectSlug/builds/$buildId"
          params={{ projectSlug, buildId: resourceId }}
          className={className}
        >
          {children}
        </RouterLink>
      );
    }
    case "update": {
      return (
        <RouterLink
          to="/projects/$projectSlug/updates/$updateId"
          params={{ projectSlug, updateId: resourceId }}
          className={className}
        >
          {children}
        </RouterLink>
      );
    }
    case "channel": {
      return (
        <RouterLink
          to="/projects/$projectSlug/channels/$channelId"
          params={{ projectSlug, channelId: resourceId }}
          className={className}
        >
          {children}
        </RouterLink>
      );
    }
    // A branch has no page of its own; its updates are what anyone following the
    // row is after, which is where the Branches list sends its own rows too.
    case "branch": {
      return (
        <RouterLink
          to="/projects/$projectSlug/updates"
          params={{ projectSlug }}
          search={{ page: 1, sort: "-createdAt" as const, branchId: [resourceId] }}
          className={className}
        >
          {children}
        </RouterLink>
      );
    }
    case "project": {
      return (
        <RouterLink to="/projects/$projectSlug" params={{ projectSlug }} className={className}>
          {children}
        </RouterLink>
      );
    }
    default: {
      return children;
    }
  }
};
