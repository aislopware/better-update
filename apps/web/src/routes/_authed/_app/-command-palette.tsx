import { projectsQueryOptions } from "@better-update/api-client/react";
import { useMountEffect } from "@better-update/react-hooks";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@better-update/ui/components/ui/command";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";

import type { LucideIcon } from "lucide-react";

import { PROJECT_NAV, useOrgNavSections } from "../-sidebar-nav";
import { fireAndForget } from "../../../lib/data-table";
import { EntityAvatar } from "../../../lib/entity-avatar";
import { useTheme } from "../../../lib/use-theme";
import { DROPDOWN_FETCH_LIMIT } from "../../../queries/constants";

import type { Theme } from "../../../lib/use-theme";

const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT");

// Palette items mirror the sidebar exactly: org-level nav (capability-gated
// via useOrgNavSections) outside a project, project subpages inside one.
const OrgNavigationGroup = ({
  isSuperadmin,
  close,
}: {
  isSuperadmin: boolean;
  close: () => void;
}) => {
  const navigate = useNavigate();
  const items = useOrgNavSections(isSuperadmin).flatMap((section) => section.items);
  return (
    <CommandGroup heading="Navigation">
      {items.map((item) => (
        <CommandItem
          key={item.to}
          value={item.to}
          keywords={[item.label]}
          onSelect={() => {
            close();
            fireAndForget(navigate({ to: item.to }));
          }}
        >
          <item.icon strokeWidth={2} />
          <span>{item.label}</span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
};

const ProjectNavigationGroup = ({
  projectSlug,
  close,
}: {
  projectSlug: string;
  close: () => void;
}) => {
  const navigate = useNavigate();
  const items = PROJECT_NAV.flatMap((section) => section.items);
  return (
    <CommandGroup heading="Navigation">
      {items.map((item) => (
        <CommandItem
          key={item.to}
          value={item.to}
          keywords={[item.label]}
          onSelect={() => {
            close();
            fireAndForget(navigate({ to: item.to, params: { projectSlug } }));
          }}
        >
          <item.icon strokeWidth={2} />
          <span>{item.label}</span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
};

const ProjectsGroup = ({
  orgId,
  enabled,
  close,
}: {
  orgId: string;
  enabled: boolean;
  close: () => void;
}) => {
  const navigate = useNavigate();
  // Same bounded query the breadcrumb project switcher uses (shared cache key);
  // fetched lazily once the palette opens. Orgs with more projects than the
  // limit still have full-text search on /projects.
  const { data } = useQuery({
    ...projectsQueryOptions(orgId, { limit: DROPDOWN_FETCH_LIMIT }),
    enabled,
  });
  if (!data || data.items.length === 0) {
    return null;
  }
  return (
    <CommandGroup heading="Projects">
      {data.items.map((project) => (
        <CommandItem
          key={project.id}
          value={`project:${project.slug}`}
          keywords={[project.name, project.slug]}
          onSelect={() => {
            close();
            fireAndForget(
              navigate({
                to: "/projects/$projectSlug",
                params: { projectSlug: project.slug },
              }),
            );
          }}
        >
          <EntityAvatar
            name={project.name}
            seed={project.slug}
            image={project.logoUrl}
            size="sm"
            shape="square"
          />
          <span className="truncate">{project.name}</span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
};

const THEME_ITEMS: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
];

const ThemeGroup = ({ close }: { close: () => void }) => {
  const { updateTheme } = useTheme();
  return (
    <CommandGroup heading="Theme">
      {THEME_ITEMS.map((item) => (
        <CommandItem
          key={item.value}
          value={`theme:${item.value}`}
          keywords={["theme", item.label]}
          onSelect={() => {
            close();
            updateTheme(item.value);
          }}
        >
          <item.icon strokeWidth={2} />
          <span>{item.label} theme</span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
};

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

  const close = (): void => {
    onOpenChange(false);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Search pages, projects, and theme actions"
    >
      <Command>
        <CommandInput placeholder="Search pages, projects…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          {projectSlug ? (
            <ProjectNavigationGroup projectSlug={projectSlug} close={close} />
          ) : (
            <OrgNavigationGroup isSuperadmin={isSuperadmin} close={close} />
          )}
          <ProjectsGroup orgId={orgId} enabled={open} close={close} />
          <ThemeGroup close={close} />
        </CommandList>
      </Command>
    </CommandDialog>
  );
};
