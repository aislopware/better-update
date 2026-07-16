import { Button } from "@better-update/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@better-update/ui/components/ui/dropdown-menu";
import { Kbd } from "@better-update/ui/components/ui/kbd";
import { Separator } from "@better-update/ui/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@better-update/ui/components/ui/sidebar";
import { Skeleton } from "@better-update/ui/components/ui/skeleton";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { TooltipProvider } from "@better-update/ui/components/ui/tooltip";
import { useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  createFileRoute,
  redirect,
  useChildMatches,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import {
  PlusIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  LogOutIcon,
  SearchIcon,
  UserIcon,
} from "lucide-react";
import { Suspense, useState } from "react";

import { DetailCardSkeleton } from "../../components/skeletons";
import { renderSwitcherIndicator } from "../../components/switcher-indicator";
import { isSuperadminUser } from "../../lib/access";
import { authClient, rejectOnAuthClientError } from "../../lib/auth-client";
import { DocumentTitle } from "../../lib/document-title";
import { EntityAvatar } from "../../lib/entity-avatar";
import { ErrorBoundary } from "../../lib/error-boundary";
import { logout } from "../../lib/logout";
import { useApiMutation } from "../../lib/use-api-mutation";
import { sessionQueryOptions } from "../../queries/auth";
import { orgKeyPrefix } from "../../queries/org";
import { CreateOrgDialog } from "./-create-org-dialog";
import { HeaderBreadcrumbs } from "./-header-breadcrumbs";
import { ProjectSwitcher } from "./-project-switcher";
import { OrgNavSections, ProjectNavSections } from "./-sidebar-nav";
import { CommandPalette } from "./_app/-command-palette";

const useActiveProjectSlug = (): string | undefined =>
  useChildMatches({
    select: (matches) => {
      const match = matches.find(
        (entry): entry is typeof entry & { params: { projectSlug: string } } =>
          "projectSlug" in entry.params,
      );
      return match?.params.projectSlug;
    },
  });

const renderOrgTrigger = (
  name: string,
  slug: string | undefined,
  image: string | null | undefined,
) => (
  <SidebarMenuButton size="lg" className="data-open:bg-sidebar-accent w-full">
    <EntityAvatar name={name} seed={slug ?? name} image={image} shape="square" className="size-8" />
    <div className="grid flex-1 text-left text-sm leading-tight">
      <span className="truncate font-semibold">{name}</span>
      <span className="text-muted-foreground truncate text-xs">{slug}</span>
    </div>
    <ChevronsUpDownIcon strokeWidth={2} className="text-muted-foreground ml-auto size-4" />
  </SidebarMenuButton>
);

const renderUserTrigger = (
  name: string | undefined,
  image: string | null | undefined,
  email: string | undefined,
) => (
  <SidebarMenuButton size="lg" className="data-open:bg-sidebar-accent w-full">
    <EntityAvatar name={name ?? "U"} image={image} className="size-8" />
    <div className="grid flex-1 text-left text-sm leading-tight">
      <span className="truncate font-semibold">{name}</span>
      <span className="text-muted-foreground truncate text-xs">{email}</span>
    </div>
    <ChevronsUpDownIcon strokeWidth={2} className="text-muted-foreground ml-auto size-4" />
  </SidebarMenuButton>
);

const OrgSwitcher = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [createOrgOpen, setCreateOrgOpen] = useState(false);
  const { activeOrg, orgs } = Route.useRouteContext();
  const activeOrgId = activeOrg.id;
  const displayName = activeOrg.name;

  const switchOrg = useApiMutation({
    mutationFn: async (orgId: string) =>
      rejectOnAuthClientError(
        authClient.organization.setActive({
          organizationId: orgId,
          fetchOptions: { disableSignal: true },
        }),
        "Failed to switch organization",
      ),
    onSuccess: async (_data, orgId) => {
      // Drop both orgs' caches before navigating so nothing re-targets the
      // previous org and the new org's pages load fresh.
      if (activeOrgId) {
        queryClient.removeQueries({ queryKey: orgKeyPrefix(activeOrgId) });
      }
      queryClient.removeQueries({ queryKey: orgKeyPrefix(orgId) });
      await queryClient.refetchQueries({ queryKey: sessionQueryOptions.queryKey, type: "all" });
      // Land on All Projects before invalidating: the current route may point
      // at a project that does not exist in the new org ("Unknown project").
      await router.navigate({ to: "/projects" });
      await router.invalidate();
      setMenuOpen(false);
    },
  });

  const switchingOrgId = switchOrg.isPending ? switchOrg.variables : undefined;

  const handleOrgSwitch = (orgId: string): void => {
    if (switchOrg.isPending) {
      return;
    }
    if (orgId === activeOrgId) {
      setMenuOpen(false);
      return;
    }
    switchOrg.mutate(orgId);
  };

  return (
    <>
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(next) => {
          // Keep the menu (and its per-org spinner) visible while a switch is
          // in flight; it closes itself once the new org has loaded.
          if (next || !switchOrg.isPending) {
            setMenuOpen(next);
          }
        }}
      >
        <DropdownMenuTrigger
          render={renderOrgTrigger(displayName, activeOrg.slug, activeOrg.logo)}
        />
        {/* Default w-(--anchor-width) matches the expanded trigger (canonical
            team-switcher look); min-w keeps it usable in icon-collapsed mode. */}
        <DropdownMenuContent align="start" side="bottom" sideOffset={4} className="min-w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Organizations</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {orgs.map((org) => {
              const isSwitching = switchingOrgId === org.id;
              const isActive = org.id === activeOrgId;
              return (
                <DropdownMenuItem
                  key={org.id}
                  onClick={() => {
                    handleOrgSwitch(org.id);
                  }}
                  data-pending={isSwitching || undefined}
                  disabled={switchOrg.isPending && !isSwitching}
                  closeOnClick={false}
                >
                  <EntityAvatar
                    name={org.name}
                    seed={org.slug}
                    image={org.logo}
                    size="sm"
                    shape="square"
                  />
                  <span className="flex-1 truncate">{org.name}</span>
                  {renderSwitcherIndicator(isSwitching, isActive)}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              setCreateOrgOpen(true);
            }}
            disabled={switchOrg.isPending}
          >
            <PlusIcon strokeWidth={2} className="size-4" />
            <span>Create organization</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateOrgDialog open={createOrgOpen} onOpenChange={setCreateOrgOpen} />
    </>
  );
};

const UserMenu = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = Route.useRouteContext();
  const { user } = session;

  const logoutMutation = useApiMutation({
    mutationFn: async () => logout(queryClient),
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={renderUserTrigger(user.name, user.image, user.email)} />
      <DropdownMenuContent align="start" side="top" sideOffset={4} className="min-w-56">
        <DropdownMenuGroup>
          {/* Canonical nav-user label block: avatar + name + email. */}
          <DropdownMenuLabel className="p-0 font-normal">
            <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
              <EntityAvatar name={user.name || "U"} image={user.image} className="size-8" />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="text-foreground truncate font-medium">{user.name}</span>
                <span className="text-muted-foreground truncate text-xs">{user.email}</span>
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={async () => {
              await router.navigate({ to: "/account/profile" });
            }}
            disabled={logoutMutation.isPending}
          >
            <UserIcon strokeWidth={2} className="size-4" />
            <span>Account</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              logoutMutation.mutate();
            }}
            disabled={logoutMutation.isPending}
            closeOnClick={false}
          >
            {logoutMutation.isPending ? (
              <Spinner className="size-4" />
            ) : (
              <LogOutIcon strokeWidth={2} className="size-4" />
            )}
            <span>{logoutMutation.isPending ? "Logging out…" : "Log out"}</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const AppSidebarRail = () => {
  const { state } = useSidebar();
  const Icon = state === "expanded" ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <SidebarRail className="group/rail z-40 hover:after:bg-transparent">
      <span className="bg-background pointer-events-none absolute top-1/2 left-1/2 z-50 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border opacity-0 shadow-sm transition-opacity duration-150 ease-out group-hover/rail:opacity-100">
        <Icon strokeWidth={2} className="size-3.5" />
      </span>
    </SidebarRail>
  );
};

const AppSidebar = ({
  projectSlug,
  isSuperadmin,
}: {
  projectSlug: string | undefined;
  isSuperadmin: boolean;
}) => (
  <Sidebar collapsible="icon">
    {/* Fixed to the header height so the org trigger stays middle-aligned with
        the header row in both expanded (48px button) and collapsed (32px
        avatar) states, and the nav below starts under the header divider. */}
    <SidebarHeader className="h-(--header-height) shrink-0 justify-center">
      <SidebarMenu>
        <SidebarMenuItem>
          <OrgSwitcher />
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>
    <SidebarContent>
      {projectSlug ? (
        <ProjectNavSections projectSlug={projectSlug} />
      ) : (
        <OrgNavSections isSuperadmin={isSuperadmin} />
      )}
    </SidebarContent>
    <SidebarFooter>
      <SidebarMenu>
        <SidebarMenuItem>
          <UserMenu />
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
    <AppSidebarRail />
  </Sidebar>
);

// Vercel-style: while the sidebar is expanded, collapsing happens by clicking
// the rail divider itself, so the header trigger only appears once the sidebar
// is collapsed (and always on mobile, where the sidebar is an offcanvas sheet).
const HeaderSidebarControls = () => {
  const { state, isMobile } = useSidebar();
  if (!isMobile && state === "expanded") {
    return null;
  }
  return (
    <>
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="my-auto data-[orientation=vertical]:h-4" />
    </>
  );
};

// Docs-style ⌘K entry point in the site header: icon-only on mobile, a muted
// pseudo-input with the shortcut hint from `sm` up.
const HeaderSearchButton = ({ onClick }: { onClick: () => void }) => (
  <Button
    variant="outline"
    aria-label="Search"
    onClick={onClick}
    className="text-muted-foreground size-8 justify-center p-0 font-normal shadow-none sm:w-48 sm:justify-start sm:px-2.5"
  >
    <SearchIcon strokeWidth={2} />
    <span className="hidden flex-1 text-left sm:inline">Search…</span>
    <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
  </Button>
);

const AppLayout = () => {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const projectSlug = useActiveProjectSlug();
  const { activeOrg, user } = Route.useRouteContext();
  const [commandOpen, setCommandOpen] = useState(false);
  const isSuperadmin = isSuperadminUser(user);
  return (
    <TooltipProvider>
      <DocumentTitle />
      <SidebarProvider>
        <AppSidebar projectSlug={projectSlug} isSuperadmin={isSuperadmin} />
        <SidebarInset className="min-w-0">
          <header className="bg-background/80 sticky top-0 z-30 flex h-(--header-height) shrink-0 items-center justify-between gap-2 border-b px-4 backdrop-blur lg:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <HeaderSidebarControls />
              <Suspense fallback={<Skeleton className="h-7 w-32 rounded-md" />}>
                <ProjectSwitcher orgId={activeOrg.id} currentProjectSlug={projectSlug} />
              </Suspense>
              <HeaderBreadcrumbs projectSlug={projectSlug} />
            </div>
            <div className="flex min-w-0 items-center justify-end">
              <HeaderSearchButton
                onClick={() => {
                  setCommandOpen(true);
                }}
              />
            </div>
          </header>
          <main className="min-w-0 flex-1 px-4 py-6 lg:px-6 lg:py-8">
            <ErrorBoundary key={pathname}>
              <Suspense fallback={<DetailCardSkeleton rows={3} columns={2} />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </main>
        </SidebarInset>
        <CommandPalette
          open={commandOpen}
          onOpenChange={setCommandOpen}
          orgId={activeOrg.id}
          projectSlug={projectSlug}
          isSuperadmin={isSuperadmin}
        />
      </SidebarProvider>
    </TooltipProvider>
  );
};

export const Route = createFileRoute("/_authed/_app")({
  beforeLoad: async ({ context }) => {
    const [firstOrg] = context.orgs;
    if (!firstOrg) {
      // eslint-disable-next-line functional/no-throw-statements, functional/no-promise-reject, typescript/only-throw-error -- TanStack Router idiom: throw redirect preserves typed `to` inference
      throw redirect({ to: "/onboarding" });
    }
    const activeOrgId = context.session.session.activeOrganizationId;
    const activeOrg = context.orgs.find((org) => org.id === activeOrgId) ?? firstOrg;
    if (activeOrg.id !== activeOrgId) {
      // eslint-disable-next-line functional/no-try-statements -- defensive try/catch swallows setActive transient failure (e.g. `throw undefined` from underlying fetch) so beforeLoad does not crash route render; UI proceeds with the previously active org and a subsequent navigation/login retries
      try {
        const { error } = await authClient.organization.setActive({
          organizationId: activeOrg.id,
          fetchOptions: { disableSignal: true },
        });
        if (!error) {
          context.queryClient.setQueryData(sessionQueryOptions.queryKey, (prev) =>
            prev
              ? { ...prev, session: { ...prev.session, activeOrganizationId: activeOrg.id } }
              : prev,
          );
        }
      } catch {
        // Non-fatal
      }
    }
    return { activeOrg };
  },
  component: AppLayout,
});
