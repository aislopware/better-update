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
import { Outlet, createFileRoute, useRouter, useRouterState } from "@tanstack/react-router";
import {
  PlusIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MonitorIcon,
  LogOutIcon,
  MoonIcon,
  SunIcon,
  CheckIcon,
  UserIcon,
} from "lucide-react";
import { Suspense, useState } from "react";

import { redirectToAccounts } from "../../lib/accounts-redirect";
import { authClient } from "../../lib/auth-client";
import { DocumentTitle } from "../../lib/document-title";
import { EntityAvatar } from "../../lib/entity-avatar";
import { ErrorBoundary } from "../../lib/error-boundary";
import { throwRedirect } from "../../lib/throw-redirect";
import { useTheme } from "../../lib/use-theme";
import { orgsQueryOptions, sessionQueryOptions } from "../../queries/auth";
import { AppBreadcrumb } from "./-app-breadcrumb";
import { CreateOrgDialog } from "./-create-org-dialog";
import { OrgNavSections, ProjectNavSections } from "./-sidebar-nav";

import type { Theme } from "../../lib/use-theme";

const THEMES = new Set<string>(["light", "dark", "system"]);
const isTheme = (value: unknown): value is Theme => typeof value === "string" && THEMES.has(value);

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
    <EntityAvatar name={name} shape="square" className="size-8" />
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
  const { data: orgs } = useSuspenseQuery(orgsQueryOptions);
  const { data: session } = useSuspenseQuery(sessionQueryOptions);
  const activeOrgId = session?.session.activeOrganizationId;
  const activeOrg = orgs.find((org) => org.id === activeOrgId) ?? orgs[0];
  const displayName = activeOrg?.name ?? "No org";

  const handleOrgSwitch = async (orgId: string) => {
    if (orgId === activeOrgId) {
      return;
    }
    const prevOrgId = activeOrgId;
    await authClient.organization.setActive({ organizationId: orgId });
    if (prevOrgId) {
      queryClient.removeQueries({ queryKey: ["org", prevOrgId] });
    }
    await queryClient.resetQueries({ queryKey: ["auth", "session"] });
    await router.invalidate();
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={renderOrgTrigger(displayName, activeOrg?.slug)} />
        <DropdownMenuContent align="start" side="bottom" sideOffset={4} className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Organizations</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {orgs.map((org) => (
              <DropdownMenuItem key={org.id} onClick={async () => handleOrgSwitch(org.id)}>
                <EntityAvatar name={org.name} size="sm" shape="square" />
                <span className="flex-1 truncate">{org.name}</span>
                {org.id === activeOrgId ? (
                  <CheckIcon strokeWidth={2} className="text-primary size-4" />
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              setCreateOrgOpen(true);
            }}
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

  const handleLogout = async () => {
    await authClient.signOut();
    await queryClient.resetQueries({ queryKey: ["auth"] });
    redirectToAccounts("/login");
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
          >
            <UserIcon strokeWidth={2} className="size-4" />
            <span>Account</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleLogout}>
            <LogOutIcon strokeWidth={2} className="size-4" />
            <span>Log out</span>
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

const NavigationProgress = () => {
  const isNavigating = useRouterState({
    select: (state) => state.isLoading || state.isTransitioning,
  });

  if (!isNavigating) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-50">
      <div
        className="bg-primary h-0.5"
        style={{ animation: "progress-grow 8s cubic-bezier(0.1, 0.05, 0, 1) forwards" }}
      />
    </div>
  );
};

const AppSidebarRail = () => {
  const { state } = useSidebar();
  const Icon = state === "expanded" ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <SidebarRail className="group/rail z-40">
      <span className="bg-background pointer-events-none absolute top-1/2 left-1/2 z-50 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border opacity-0 shadow-sm transition-opacity group-hover/rail:opacity-100">
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
          <NavigationProgress />
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
      throwRedirect({ to: "/onboarding" });
    }

    const activeOrgId = context.session?.session.activeOrganizationId;
    const activeOrg = context.orgs.find((org) => org.id === activeOrgId);

    if (!activeOrg) {
      await authClient.organization.setActive({ organizationId: firstOrg.id });
    }

    return { activeOrg: activeOrg ?? firstOrg };
  },
  component: AppLayout,
});
