import { projectsQueryOptions } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogPopup,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import {
  Menu,
  MenuPopup,
  MenuGroup,
  MenuItem,
  MenuGroupLabel,
  MenuSeparator,
  MenuTrigger,
} from "@better-update/ui/components/ui/menu";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { renderSwitcherIndicator } from "../../components/switcher-indicator";
import { EntityAvatar } from "../../lib/entity-avatar";
import { CreateProjectFormContent } from "./_app/projects/-create-dialog";

const switcherTrigger = (displayName: string) => (
  <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 font-medium">
    <span className="truncate">{displayName}</span>
    <ChevronsUpDownIcon strokeWidth={2} className="text-muted-foreground size-3" />
  </Button>
);

interface ProjectSwitcherProps {
  readonly orgId: string;
  readonly currentProjectSlug: string;
}

export const ProjectSwitcher = ({ orgId, currentProjectSlug }: ProjectSwitcherProps) => {
  const router = useRouter();
  // Switcher dropdown is bounded to the most-recent 100 projects (sorted by
  // Last activity). If the org has more, the user can navigate to /projects
  // Which has full-text search.
  const { data } = useSuspenseQuery(projectsQueryOptions(orgId, { limit: 100 }));
  const [createOpen, setCreateOpen] = useState(false);
  const [navigatingSlug, setNavigatingSlug] = useState<string | undefined>(undefined);

  const currentProject = data.items.find((project) => project.slug === currentProjectSlug);
  const displayName = currentProject?.name ?? "Unknown project";
  const hasMore = data.total > data.items.length;

  const handleSelect = async (projectSlug: string) => {
    if (projectSlug === currentProjectSlug || navigatingSlug) {
      return;
    }
    setNavigatingSlug(projectSlug);
    await router.navigate({ to: "/projects/$projectSlug", params: { projectSlug } });
    setNavigatingSlug(undefined);
  };

  return (
    <>
      <Menu>
        <MenuTrigger render={switcherTrigger(displayName)} />
        <MenuPopup align="start" side="bottom" sideOffset={4} className="w-64">
          <MenuGroup>
            <MenuGroupLabel>Projects</MenuGroupLabel>
            <MenuSeparator />
            {data.items.length === 0 ? (
              <MenuGroupLabel className="text-muted-foreground text-xs font-normal">
                No projects yet
              </MenuGroupLabel>
            ) : (
              data.items.map((project) => {
                const isNavigating = navigatingSlug === project.slug;
                const isActive = project.slug === currentProjectSlug;
                return (
                  <MenuItem
                    key={project.id}
                    onClick={async () => handleSelect(project.slug)}
                    data-pending={isNavigating || undefined}
                    disabled={Boolean(navigatingSlug) && !isNavigating}
                  >
                    <EntityAvatar
                      name={project.name}
                      seed={project.slug}
                      size="sm"
                      shape="square"
                    />
                    <span className="flex-1 truncate">{project.name}</span>
                    {renderSwitcherIndicator(isNavigating, isActive)}
                  </MenuItem>
                );
              })
            )}
          </MenuGroup>
          {hasMore ? (
            <MenuGroupLabel className="text-muted-foreground text-xs font-normal">
              Showing {data.items.length} of {data.total}. Open the projects page to search.
            </MenuGroupLabel>
          ) : null}
          <MenuSeparator />
          <MenuItem
            onClick={() => {
              setCreateOpen(true);
            }}
            disabled={Boolean(navigatingSlug)}
          >
            <PlusIcon strokeWidth={2} className="size-4" />
            <span>Create project</span>
          </MenuItem>
        </MenuPopup>
      </Menu>
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Create a project</DialogTitle>
            <DialogDescription>
              Projects organize your OTA updates and deployment channels.
            </DialogDescription>
          </DialogHeader>
          <CreateProjectFormContent
            orgId={orgId}
            onSuccess={() => {
              setCreateOpen(false);
            }}
          />
        </DialogPopup>
      </Dialog>
    </>
  );
};
