import {
  Menu,
  MenuPopup,
  MenuGroup,
  MenuItem,
  MenuGroupLabel,
  MenuSeparator,
  MenuTrigger,
} from "@better-update/ui/components/ui/menu";
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
  useSidebar,
} from "@better-update/ui/components/ui/sidebar";
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
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LogOutIcon,
  UserIcon,
} from "lucide-react";
import { Suspense, useState } from "react";

import { renderSwitcherIndicator } from "../../components/switcher-indicator";
import { authClient, rejectOnAuthClientError } from "../../lib/auth-client";
import { DocumentTitle } from "../../lib/document-title";
import { EntityAvatar } from "../../lib/entity-avatar";
import { ErrorBoundary } from "../../lib/error-boundary";
import { logout } from "../../lib/logout";
import { useApiMutation } from "../../lib/use-api-mutation";
import { sessionQueryOptions } from "../../queries/auth";
import { orgKeyPrefix } from "../../queries/org";
import { AppBreadcrumb } from "./-app-breadcrumb";
import { CreateOrgDialog } from "./-create-org-dialog";
import { OrgNavSections, ProjectNavSections } from "./-sidebar-nav";

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

const renderOrgTrigger = (name: string, slug: string | undefined) => (
  <SidebarMenuButton size="lg" className="data-open:bg-sidebar-accent w-full">
    <EntityAvatar name={name} seed={slug ?? name} shape="square" className="size-8" />
    <div className="grid flex-1 text-left text-sm leading-tight">
      <span className="truncate font-semibold">{name}</span>
      <span className="text-muted-foreground truncate text-xs">{slug}</span>
    </div>
    <ChevronDownIcon strokeWidth={2} className="ml-auto size-4" />
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
  </SidebarMenuButton>
);

const OrgSwitcher = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
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
      if (activeOrgId) {
        queryClient.removeQueries({ queryKey: orgKeyPrefix(activeOrgId) });
      }
      await queryClient.refetchQueries({ queryKey: sessionQueryOptions.queryKey, type: "all" });
      await router.invalidate();
      // Side-effect: reset cached active org so it does not re-target the previous one.
      queryClient.removeQueries({ queryKey: orgKeyPrefix(orgId) });
    },
  });

  const switchingOrgId = switchOrg.isPending ? switchOrg.variables : undefined;

  const handleOrgSwitch = (orgId: string): void => {
    if (orgId === activeOrgId || switchOrg.isPending) {
      return;
    }
    switchOrg.mutate(orgId);
  };

  return (
    <>
      <Menu>
        <MenuTrigger render={renderOrgTrigger(displayName, activeOrg.slug)} />
        <MenuPopup align="start" side="bottom" sideOffset={4} className="w-64">
          <MenuGroup>
            <MenuGroupLabel>Organizations</MenuGroupLabel>
            <MenuSeparator />
            {orgs.map((org) => {
              const isSwitching = switchingOrgId === org.id;
              const isActive = org.id === activeOrgId;
              return (
                <MenuItem
                  key={org.id}
                  onClick={() => {
                    handleOrgSwitch(org.id);
                  }}
                  data-pending={isSwitching || undefined}
                  disabled={switchOrg.isPending && !isSwitching}
                >
                  <EntityAvatar name={org.name} seed={org.slug} size="sm" shape="square" />
                  <span className="flex-1 truncate">{org.name}</span>
                  {renderSwitcherIndicator(isSwitching, isActive)}
                </MenuItem>
              );
            })}
          </MenuGroup>
          <MenuSeparator />
          <MenuItem
            onClick={() => {
              setCreateOrgOpen(true);
            }}
            disabled={switchOrg.isPending}
          >
            <PlusIcon strokeWidth={2} className="size-4" />
            <span>Create organization</span>
          </MenuItem>
        </MenuPopup>
      </Menu>
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
    <Menu>
      <MenuTrigger render={renderUserTrigger(user.name, user.image, user.email)} />
      <MenuPopup align="start" side="top" sideOffset={4} className="w-56">
        <MenuGroup>
          <MenuGroupLabel>{user.name}</MenuGroupLabel>
          <MenuSeparator />
          <MenuItem
            onClick={async () => {
              await router.navigate({ to: "/account/profile" });
            }}
            disabled={logoutMutation.isPending}
          >
            <UserIcon strokeWidth={2} className="size-4" />
            <span>Account</span>
          </MenuItem>
          <MenuSeparator />
          <MenuItem
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
          </MenuItem>
        </MenuGroup>
      </MenuPopup>
    </Menu>
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

const AppSidebar = ({ projectSlug }: { projectSlug: string | undefined }) => (
  <Sidebar collapsible="icon" variant="inset">
    <SidebarHeader>
      <SidebarMenu>
        <SidebarMenuItem>
          <OrgSwitcher />
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>
    <SidebarContent>
      {projectSlug ? <ProjectNavSections projectSlug={projectSlug} /> : <OrgNavSections />}
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

const AppLayout = () => {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const projectSlug = useActiveProjectSlug();
  const { activeOrg } = Route.useRouteContext();
  return (
    <TooltipProvider>
      <DocumentTitle />
      <SidebarProvider>
        <AppSidebar projectSlug={projectSlug} />
        <SidebarInset className="relative md:border">
          <header className="bg-background/80 sticky top-0 z-30 flex h-(--header-height) shrink-0 items-center gap-2 border-b px-4 backdrop-blur md:rounded-t-xl lg:px-6">
            <AppBreadcrumb
              orgId={activeOrg.id}
              orgName={activeOrg.name}
              projectSlug={projectSlug}
            />
          </header>
          <main className="flex-1 px-4 py-6 lg:px-6 lg:py-8">
            <ErrorBoundary key={pathname}>
              <Suspense fallback={null}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </main>
        </SidebarInset>
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
