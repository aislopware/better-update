import { projectsQueryOptions } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@better-update/ui/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@better-update/ui/components/ui/popover";
import { keepPreviousData, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { ChevronsUpDownIcon, FolderIcon, PlusIcon } from "lucide-react";
import { useDeferredValue, useState } from "react";

import { fireAndForget } from "../../lib/data-table";
import { EntityAvatar } from "../../lib/entity-avatar";
import { DROPDOWN_FETCH_LIMIT } from "../../queries/constants";
import { CreateProjectFormContent } from "./_app/projects/-create-dialog";

const switcherTrigger = (displayName: string) => (
  <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 font-medium">
    <span className="truncate">{displayName}</span>
    <ChevronsUpDownIcon strokeWidth={2} className="text-muted-foreground size-3" />
  </Button>
);

interface ProjectSwitcherProps {
  readonly orgId: string;
  /** Undefined on org-level pages — the switcher then shows "All Projects". */
  readonly currentProjectSlug: string | undefined;
}

export const ProjectSwitcher = ({ orgId, currentProjectSlug }: ProjectSwitcherProps) => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [createOpen, setCreateOpen] = useState(false);
  const [createResetKey, setCreateResetKey] = useState(0);

  // Recent projects power both the trigger label and the default list; typing
  // switches to a server-side search across the whole org (the recent list is
  // bounded to the most recently active N).
  const { data: recent } = useSuspenseQuery(
    projectsQueryOptions(orgId, { limit: DROPDOWN_FETCH_LIMIT }),
  );
  const isSearching = deferredSearch.length > 0;
  const searchResults = useQuery({
    ...projectsQueryOptions(orgId, { limit: DROPDOWN_FETCH_LIMIT, query: deferredSearch }),
    enabled: isSearching,
    placeholderData: keepPreviousData,
  });
  const items = (isSearching ? searchResults.data?.items : recent.items) ?? [];

  const currentProject = currentProjectSlug
    ? recent.items.find((project) => project.slug === currentProjectSlug)
    : undefined;
  const displayName =
    currentProject?.name ?? (currentProjectSlug ? "Unknown project" : "All Projects");

  const navigateToProject = (projectSlug: string): void => {
    setOpen(false);
    if (projectSlug !== currentProjectSlug) {
      fireAndForget(router.navigate({ to: "/projects/$projectSlug", params: { projectSlug } }));
    }
  };

  return (
    <>
      <Popover
        open={open}
        onOpenChange={setOpen}
        onOpenChangeComplete={(next) => {
          if (!next) {
            setSearch("");
          }
        }}
      >
        <PopoverTrigger render={switcherTrigger(displayName)} />
        <PopoverContent className="w-64 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Search projects…" value={search} onValueChange={setSearch} />
            <CommandList>
              <CommandGroup>
                <CommandItem
                  data-checked={!currentProjectSlug}
                  onSelect={() => {
                    setOpen(false);
                    fireAndForget(router.navigate({ to: "/projects" }));
                  }}
                >
                  <FolderIcon strokeWidth={2} className="text-muted-foreground" />
                  <span>All Projects</span>
                </CommandItem>
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading="Projects">
                {/* CommandEmpty never fires with shouldFilter=false + the
                    always-present action items, so the empty state is manual. */}
                {items.length === 0 ? (
                  <div className="text-muted-foreground py-6 text-center text-sm">
                    {isSearching && searchResults.isPending ? "Searching…" : "No projects found."}
                  </div>
                ) : null}
                {items.map((project) => (
                  <CommandItem
                    key={project.id}
                    value={project.slug}
                    data-checked={project.slug === currentProjectSlug}
                    onSelect={() => {
                      navigateToProject(project.slug);
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
              <CommandSeparator />
              <CommandGroup>
                <CommandItem
                  onSelect={() => {
                    setOpen(false);
                    setCreateOpen(true);
                  }}
                >
                  <PlusIcon strokeWidth={2} className="text-muted-foreground" />
                  <span>Create project</span>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onOpenChangeComplete={(next) => {
          if (!next) {
            setCreateResetKey((prev) => prev + 1);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create a project</DialogTitle>
            <DialogDescription>
              Projects organize your OTA updates and deployment channels.
            </DialogDescription>
          </DialogHeader>
          <CreateProjectFormContent
            key={createResetKey}
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
