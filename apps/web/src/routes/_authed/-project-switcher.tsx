import { projectsQueryOptions } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/button";
import { CommandPalette as Palette } from "@better-update/ui/components/command-palette";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@better-update/ui/components/dialog";
import { Popover } from "@better-update/ui/components/popover";
import { keepPreviousData, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { CheckIcon, ChevronsUpDownIcon, FolderIcon, PlusIcon } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";

import type { ReactNode } from "react";

import { fireAndForget } from "../../lib/data-table";
import { EntityAvatar } from "../../lib/entity-avatar";
import { DROPDOWN_FETCH_LIMIT } from "../../queries/constants";
import { CreateProjectFormContent } from "./_app/projects/-create-dialog";

/**
 * The switcher reuses the command palette's panel — the same component minus
 * its dialog — so one keyboard model covers both: type to narrow, arrows to
 * move, Enter to go. The two standing actions are entries in their own groups
 * rather than chrome around the list, which is what keeps them reachable from
 * the keyboard.
 */
interface SwitcherItem {
  readonly id: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly checked: boolean;
  readonly run: () => void;
}

interface SwitcherGroup {
  readonly id: string;
  readonly label?: string;
  readonly items: SwitcherItem[];
}

const switcherTrigger = (displayName: string) => (
  <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 font-medium">
    <span className="truncate">{displayName}</span>
    <ChevronsUpDownIcon strokeWidth={2} className="text-kumo-subtle size-3" />
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
  // Memoised so the `?? []` fallback does not hand the groups below a fresh
  // array on every render.
  const searchedItems = searchResults.data?.items;
  const projects = useMemo(
    () => (isSearching ? searchedItems : recent.items) ?? [],
    [isSearching, recent.items, searchedItems],
  );

  const currentProject = currentProjectSlug
    ? recent.items.find((project) => project.slug === currentProjectSlug)
    : undefined;
  const displayName =
    currentProject?.name ?? (currentProjectSlug ? "Unknown project" : "All Projects");

  const groups = useMemo<SwitcherGroup[]>(
    () =>
      [
        {
          id: "all",
          items: [
            {
              id: "all-projects",
              label: "All Projects",
              icon: <FolderIcon strokeWidth={2} className="size-4" />,
              checked: !currentProjectSlug,
              run: () => {
                fireAndForget(router.navigate({ to: "/projects" }));
              },
            },
          ],
        },
        {
          id: "projects",
          label: "Projects",
          items: projects.map((project) => ({
            id: project.id,
            label: project.name,
            icon: (
              <EntityAvatar
                name={project.name}
                seed={project.slug}
                image={project.logoUrl}
                size="sm"
                shape="square"
              />
            ),
            checked: project.slug === currentProjectSlug,
            run: () => {
              if (project.slug !== currentProjectSlug) {
                fireAndForget(
                  router.navigate({
                    to: "/projects/$projectSlug",
                    params: { projectSlug: project.slug },
                  }),
                );
              }
            },
          })),
        },
        {
          id: "create",
          items: [
            {
              id: "create-project",
              label: "Create project",
              icon: <PlusIcon strokeWidth={2} className="size-4" />,
              checked: false,
              run: () => {
                setCreateOpen(true);
              },
            },
          ],
        },
        // A group with no entries still draws its heading, so drop it and let
        // the manual empty state below explain why the list is short.
      ].filter((group) => group.items.length > 0),
    [currentProjectSlug, projects, router],
  );

  const select = (item: SwitcherItem): void => {
    setOpen(false);
    item.run();
  };

  return (
    <>
      <Popover
        open={open}
        onOpenChange={setOpen}
        onOpenChangeComplete={(next: boolean) => {
          if (!next) {
            setSearch("");
          }
        }}
      >
        <Popover.Trigger render={switcherTrigger(displayName)} />
        <Popover.Content className="w-72 p-0" align="start">
          <Palette.Panel
            items={groups}
            value={search}
            onValueChange={setSearch}
            itemToStringValue={(group: SwitcherGroup) => group.label ?? group.id}
            className="max-h-96 bg-transparent"
          >
            <Palette.Input placeholder="Search projects…" />
            <Palette.List className="ring-0">
              <Palette.Results>
                {(group: SwitcherGroup) => (
                  <Palette.Group key={group.id} items={group.items}>
                    {group.label === undefined ? null : (
                      <Palette.GroupLabel>{group.label}</Palette.GroupLabel>
                    )}
                    <Palette.Items>
                      {(item: SwitcherItem) => (
                        <Palette.Item
                          key={item.id}
                          value={item}
                          onClick={() => {
                            select(item);
                          }}
                        >
                          <span className="text-kumo-subtle flex shrink-0 items-center">
                            {item.icon}
                          </span>
                          <span className="truncate">{item.label}</span>
                          {item.checked ? (
                            <CheckIcon
                              strokeWidth={2}
                              className="text-kumo-subtle ml-auto size-4"
                            />
                          ) : null}
                        </Palette.Item>
                      )}
                    </Palette.Items>
                  </Palette.Group>
                )}
              </Palette.Results>
              {projects.length === 0 ? (
                <p className="text-kumo-subtle py-6 text-center text-sm">
                  {isSearching && searchResults.isPending ? "Searching…" : "No projects found."}
                </p>
              ) : null}
            </Palette.List>
          </Palette.Panel>
        </Popover.Content>
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
        <DialogContent size="lg">
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
