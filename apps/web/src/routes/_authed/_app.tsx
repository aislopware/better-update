import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@better-update/ui/components/ui/dropdown-menu";
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
import { Skeleton } from "@better-update/ui/components/ui/skeleton";
import { TooltipProvider } from "@better-update/ui/components/ui/tooltip";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
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
  MonitorIcon,
  Loader2Icon,
  LogOutIcon,
  MoonIcon,
  SunIcon,
  UserIcon,
} from "lucide-react";
import { Suspense, useState } from "react";

import { renderSwitcherIndicator } from "../../components/switcher-indicator";
import { authClient } from "../../lib/auth-client";
import { DocumentTitle } from "../../lib/document-title";
import { EntityAvatar } from "../../lib/entity-avatar";
import { ErrorBoundary } from "../../lib/error-boundary";
import { logout } from "../../lib/logout";
import { isValidTheme } from "../../lib/theme";
import { useTheme } from "../../lib/use-theme";
import { orgsQueryOptions, sessionQueryOptions } from "../../queries/auth";
import { AppBreadcrumb } from "./-app-breadcrumb";
import { CreateOrgDialog } from "./-create-org-dialog";
import { OrgNavSections, ProjectNavSections } from "./-sidebar-nav";

import type { Theme } from "../../lib/theme";

const isTheme = (value: unknown): value is Theme =>
  typeof value === "string" && isValidTheme(value);

const PROJECT_SLUG_REGEX = /^\/projects\/([^/]+)(?:\/|$)/;
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
  const { data: orgs } = useSuspenseQuery(orgsQueryOptions);
  const { data: session } = useSuspenseQuery(sessionQueryOptions);
  const activeOrgId = session?.session.activeOrganizationId;
  const activeOrg = orgs.find((org) => org.id === activeOrgId) ?? orgs[0];
  const displayName = activeOrg?.name ?? "No org";

  const handleOrgSwitch = async (orgId: string) => {
    if (orgId === activeOrgId || switchingOrgId) {
      return;
    }
    setSwitchingOrgId(orgId);
    const prevOrgId = activeOrgId;
    await authClient.organization.setActive({ organizationId: orgId });
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
        <DropdownMenuTrigger render={renderOrgTrigger(displayName, activeOrg?.slug)} />
        <DropdownMenuContent align="start" side="bottom" sideOffset={4} className="w-64">
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
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateOrgDialog open={createOrgOpen} onOpenChange={setCreateOrgOpen} />
    </>
  );
};

const themeIcons = { light: SunIcon, dark: MoonIcon, system: MonitorIcon } as const;

const UserMenu = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session } = useSuspenseQuery(sessionQueryOptions);
  const { theme, updateTheme } = useTheme();
  const user = session?.user;
  const ThemeIcon = themeIcons[theme];
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
      <DropdownMenuTrigger render={renderUserTrigger(user?.name, user?.image, user?.email)} />
      <DropdownMenuContent align="start" side="top" sideOffset={4} className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{user?.name}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ThemeIcon strokeWidth={2} className="size-4" />
              <span>Theme</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={theme}
                onValueChange={(value: unknown) => {
                  if (isTheme(value)) {
                    updateTheme(value);
                  }
                }}
              >
                <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem
            onClick={async () => {
              await router.navigate({ to: "/account" });
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const PageSkeleton = () => (
  <div className="flex w-full flex-col gap-4">
    <Skeleton className="h-9 w-full rounded-md" />
    <Skeleton className="h-48 w-full rounded-xl" />
  </div>
);

const pageSkeleton = <PageSkeleton />;

const AppSidebarRail = () => {
  const { state } = useSidebar();
  const Icon = state === "expanded" ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <SidebarRail className="group/rail z-40">
      <span className="bg-background pointer-events-none absolute top-1/2 left-1/2 z-50 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border opacity-0 shadow-sm transition-opacity duration-150 ease-out group-hover/rail:opacity-100">
        <Icon strokeWidth={2} className="size-3.5" />
      </span>
    </SidebarRail>
  );
};

const AppSidebar = ({ projectSlug }: { projectSlug: string | undefined }) => (
  <Sidebar collapsible="icon">
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
        <SidebarInset className="bg-sidebar relative">
          <header className="bg-sidebar/80 sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b px-4 backdrop-blur">
            <AppBreadcrumb
              orgId={activeOrg.id}
              orgName={activeOrg.name}
              projectSlug={projectSlug}
            />
          </header>
          <main className="flex-1 p-4 md:p-6">
            <ErrorBoundary key={pathname}>
              <Suspense fallback={pageSkeleton}>
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
      await authClient.organization.setActive({ organizationId: activeOrg.id });
    }
    return { activeOrg };
  },
  component: AppLayout,
});
