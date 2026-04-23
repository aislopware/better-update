import { projectsQueryOptions } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@better-update/ui/components/ui/dropdown-menu";
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
  const { data } = useSuspenseQuery(projectsQueryOptions(orgId));
  const [createOpen, setCreateOpen] = useState(false);
  const [navigatingSlug, setNavigatingSlug] = useState<string | undefined>(undefined);

  const currentProject = data.items.find((project) => project.slug === currentProjectSlug);
  const displayName = currentProject?.name ?? "Unknown project";

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
      <DropdownMenu>
        <DropdownMenuTrigger render={switcherTrigger(displayName)} />
        <DropdownMenuContent align="start" side="bottom" sideOffset={4} className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Projects</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {data.items.length === 0 ? (
              <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                No projects yet
              </DropdownMenuLabel>
            ) : (
              data.items.map((project) => {
                const isNavigating = navigatingSlug === project.slug;
                const isActive = project.slug === currentProjectSlug;
                return (
                  <DropdownMenuItem
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
                  </DropdownMenuItem>
                );
              })
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              setCreateOpen(true);
            }}
            disabled={Boolean(navigatingSlug)}
          >
            <PlusIcon strokeWidth={2} className="size-4" />
            <span>Create project</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
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
        </DialogContent>
      </Dialog>
    </>
  );
};
