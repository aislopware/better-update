import { projectsQueryOptions } from "@better-update/api-client/react";
import { useMountEffect } from "@better-update/react-hooks";
import { CommandPalette as Palette } from "@better-update/ui/components/command-palette";
import { Kbd } from "@better-update/ui/components/kbd";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useDeferredValue, useMemo, useState } from "react";

import type { ReactNode } from "react";

import { PROJECT_NAV, useOrgNavSections } from "../-sidebar-nav";
import { fireAndForget } from "../../../lib/data-table";
import { EntityAvatar } from "../../../lib/entity-avatar";
import { THEME_CHOICES } from "../../../lib/theme-choices";
import { useTheme } from "../../../lib/use-theme";
import { DROPDOWN_FETCH_LIMIT } from "../../../queries/constants";

/**
 * Kumo's palette is data-driven — it takes the groups as a prop and iterates
 * them, rather than reading a tree of children. Filtering is the caller's job
 * (its own `filter` defaults to "keep everything"), which suits us: nav and
 * theme entries match locally, while projects are already narrowed server-side.
 */
interface PaletteItem {
  readonly id: string;
  readonly label: string;
  /** Everything the entry should match on, pre-lowercased. */
  readonly haystack: string;
  readonly icon: ReactNode;
  readonly run: () => void;
}

interface PaletteGroup {
  readonly id: string;
  readonly label: string;
  readonly items: PaletteItem[];
}

const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT");

const matches = (item: PaletteItem, query: string): boolean =>
  query === "" || item.haystack.includes(query);

// Palette entries mirror the sidebar exactly: org-level nav (capability-gated
// via useOrgNavSections) outside a project, project subpages inside one.
const useNavigationItems = (
  projectSlug: string | undefined,
  isSuperadmin: boolean,
): PaletteItem[] => {
  const navigate = useNavigate();
  const orgSections = useOrgNavSections(isSuperadmin);
  return useMemo(() => {
    if (projectSlug !== undefined) {
      return PROJECT_NAV.flatMap((section) => section.items).map((item) => ({
        id: item.to,
        label: item.label,
        haystack: item.label.toLowerCase(),
        icon: <item.icon weight="bold" className="size-4" />,
        run: () => {
          fireAndForget(navigate({ to: item.to, params: { projectSlug } }));
        },
      }));
    }
    return orgSections
      .flatMap((section) => section.items)
      .map((item) => ({
        id: item.to,
        label: item.label,
        haystack: item.label.toLowerCase(),
        icon: <item.icon weight="bold" className="size-4" />,
        run: () => {
          fireAndForget(navigate({ to: item.to }));
        },
      }));
  }, [navigate, orgSections, projectSlug]);
};

const useProjectItems = (orgId: string, enabled: boolean, query: string): PaletteItem[] => {
  const navigate = useNavigate();
  const isSearching = query.length > 0;
  // Same bounded query the breadcrumb project switcher uses (shared cache key);
  // fetched lazily once the palette opens. Typing switches to a server-side
  // search so projects beyond the fetch limit stay reachable.
  const base = useQuery({
    ...projectsQueryOptions(orgId, { limit: DROPDOWN_FETCH_LIMIT }),
    enabled,
  });
  const searched = useQuery({
    ...projectsQueryOptions(orgId, { limit: DROPDOWN_FETCH_LIMIT, query }),
    enabled: enabled && isSearching,
    placeholderData: keepPreviousData,
  });
  const data = isSearching ? searched.data : base.data;
  return useMemo(
    () =>
      (data?.items ?? []).map((project) => ({
        id: project.id,
        label: project.name,
        // Already narrowed server-side; the local pass must not drop a hit the
        // server made on a field we do not carry here.
        haystack: "",
        icon: (
          <EntityAvatar
            name={project.name}
            seed={project.slug}
            image={project.logoUrl}
            size="sm"
            shape="square"
          />
        ),
        run: () => {
          fireAndForget(
            navigate({ to: "/projects/$projectSlug", params: { projectSlug: project.slug } }),
          );
        },
      })),
    [data, navigate],
  );
};

const useThemeItems = (): PaletteItem[] => {
  const { updateTheme } = useTheme();
  return useMemo(
    () =>
      THEME_CHOICES.map((item) => ({
        id: `theme:${item.value}`,
        label: `${item.label} theme`,
        haystack: `theme ${item.label.toLowerCase()}`,
        icon: <item.icon weight="bold" className="size-4" />,
        run: () => {
          updateTheme(item.value);
        },
      })),
    [updateTheme],
  );
};

const PaletteFooter = () => (
  <Palette.Footer>
    <span className="flex items-center gap-3">
      <span className="inline-flex items-center gap-1">
        <Kbd>↵</Kbd> select
      </span>
      <span className="inline-flex items-center gap-1">
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd> navigate
      </span>
    </span>
    <span className="inline-flex items-center gap-1">
      <Kbd>esc</Kbd> close
    </span>
  </Palette.Footer>
);

interface CommandPaletteProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly orgId: string;
  readonly projectSlug: string | undefined;
  readonly isSuperadmin: boolean;
}

export const CommandPalette = ({
  open,
  onOpenChange,
  orgId,
  projectSlug,
  isSuperadmin,
}: CommandPaletteProps) => {
  // Controlled input so the query drives both the local match above and the
  // server-side project search.
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search.trim().toLowerCase());

  const navigationItems = useNavigationItems(projectSlug, isSuperadmin);
  const projectItems = useProjectItems(orgId, open, query);
  const themeItems = useThemeItems();

  const groups = useMemo<PaletteGroup[]>(
    () =>
      [
        {
          id: "navigation",
          label: "Navigation",
          items: navigationItems.filter((item) => matches(item, query)),
        },
        { id: "projects", label: "Projects", items: projectItems },
        { id: "theme", label: "Theme", items: themeItems.filter((item) => matches(item, query)) },
        // An empty group would still draw its heading, so drop it and let
        // Palette.Empty take over once every group is gone.
      ].filter((group) => group.items.length > 0),
    [navigationItems, projectItems, themeItems, query],
  );

  // Mount-only listener is safe: `onOpenChange` is a stable useState setter.
  useMountEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey) || event.repeat) {
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }
      event.preventDefault();
      onOpenChange(true);
    };
    globalThis.addEventListener("keydown", handleKeyDown);
    return () => {
      globalThis.removeEventListener("keydown", handleKeyDown);
    };
  });

  const select = (item: PaletteItem): void => {
    onOpenChange(false);
    setSearch("");
    item.run();
  };

  return (
    <Palette.Root
      open={open}
      onOpenChange={onOpenChange}
      items={groups}
      value={search}
      onValueChange={setSearch}
      itemToStringValue={(group: PaletteGroup) => group.label}
      onSelect={select}
      getSelectableItems={(all: PaletteGroup[]) => all.flatMap((group) => group.items)}
    >
      <Palette.Input placeholder="Search pages, projects…" />
      <Palette.List>
        <Palette.Results>
          {(group: PaletteGroup) => (
            <Palette.Group key={group.id} items={group.items}>
              <Palette.GroupLabel>{group.label}</Palette.GroupLabel>
              <Palette.Items>
                {(item: PaletteItem) => (
                  <Palette.Item
                    key={item.id}
                    value={item}
                    onClick={() => {
                      select(item);
                    }}
                  >
                    <span className="text-kumo-subtle flex shrink-0 items-center">{item.icon}</span>
                    <span className="truncate">{item.label}</span>
                  </Palette.Item>
                )}
              </Palette.Items>
            </Palette.Group>
          )}
        </Palette.Results>
        <Palette.Empty>No results found.</Palette.Empty>
      </Palette.List>
      <PaletteFooter />
    </Palette.Root>
  );
};
