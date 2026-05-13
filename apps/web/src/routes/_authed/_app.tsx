import {
  DropdownMenu,
  DropdownMenuPopup,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
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
import { TooltipProvider } from "@better-update/ui/components/ui/tooltip";
import { useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  createFileRoute,
  redirect,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import {
  PlusIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Loader2Icon,
  LogOutIcon,
  UserIcon,
} from "lucide-react";
import { Suspense, useState } from "react";

import { renderSwitcherIndicator } from "../../components/switcher-indicator";
import { authClient } from "../../lib/auth-client";
import { DocumentTitle } from "../../lib/document-title";
import { EntityAvatar } from "../../lib/entity-avatar";
import { ErrorBoundary } from "../../lib/error-boundary";
import { logout } from "../../lib/logout";
import { sessionQueryOptions } from "../../queries/auth";
import { AppBreadcrumb } from "./-app-breadcrumb";
import { CreateOrgDialog } from "./-create-org-dialog";
import { OrgNavSections, ProjectNavSections } from "./-sidebar-nav";

const PROJECT_SLUG_REGEX = /^\/projects\/([^/]+)(?:\/|$)/u;
const extractProjectSlug = (pathname: string) => {
  const match = PROJECT_SLUG_REGEX.exec(pathname);
  if (!match) {
    return undefined;
  }
  const [, projectSlug] = match;
  if (!projectSlug) {
    return undefined;
  }
  return projectSlug;
};

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
  const [switchingOrgId, setSwitchingOrgId] = useState<string | undefined>(undefined);
  const { activeOrg, orgs } = Route.useRouteContext();
  const activeOrgId = activeOrg.id;
  const displayName = activeOrg.name;

  const handleOrgSwitch = async (orgId: string) => {
    if (orgId === activeOrgId || switchingOrgId) {
      return;
    }
    setSwitchingOrgId(orgId);
    const prevOrgId = activeOrgId;
    await authClient.organization.setActive({
      organizationId: orgId,
      fetchOptions: { disableSignal: true },
    });
    if (prevOrgId) {
      queryClient.removeQueries({ queryKey: ["org", prevOrgId] });
    }
    await queryClient.resetQueries({ queryKey: ["auth", "session"] });
    await router.invalidate();
    setSwitchingOrgId(undefined);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={renderOrgTrigger(displayName, activeOrg.slug)} />
        <DropdownMenuPopup align="start" side="bottom" sideOffset={4} className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Organizations</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {orgs.map((org) => {
              const isSwitching = switchingOrgId === org.id;
              const isActive = org.id === activeOrgId;
              return (
                <DropdownMenuItem
                  key={org.id}
                  onClick={async () => handleOrgSwitch(org.id)}
                  data-pending={isSwitching || undefined}
                  disabled={Boolean(switchingOrgId) && !isSwitching}
                >
                  <EntityAvatar name={org.name} seed={org.slug} size="sm" shape="square" />
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
            disabled={Boolean(switchingOrgId)}
          >
            <PlusIcon strokeWidth={2} className="size-4" />
            <span>Create organization</span>
          </DropdownMenuItem>
        </DropdownMenuPopup>
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
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (isLoggingOut) {
      return;
    }
    setIsLoggingOut(true);
    await logout(queryClient);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={renderUserTrigger(user.name, user.image, user.email)} />
      <DropdownMenuPopup align="start" side="top" sideOffset={4} className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{user.name}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={async () => {
              await router.navigate({ to: "/account/profile" });
            }}
            disabled={isLoggingOut}
          >
            <UserIcon strokeWidth={2} className="size-4" />
            <span>Account</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={handleLogout}
            disabled={isLoggingOut}
            closeOnClick={false}
          >
            {isLoggingOut ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <LogOutIcon strokeWidth={2} className="size-4" />
            )}
            <span>{isLoggingOut ? "Logging out…" : "Log out"}</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuPopup>
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
  const projectSlug = extractProjectSlug(pathname);
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
          context.queryClient.setQueryData(sessionQueryOptions.queryKey, {
            ...context.session,
            session: { ...context.session.session, activeOrganizationId: activeOrg.id },
          });
        }
      } catch {
        // Non-fatal
      }
    }
    return { activeOrg };
  },
  component: AppLayout,
});
