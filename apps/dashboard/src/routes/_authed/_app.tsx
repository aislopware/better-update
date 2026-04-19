import { Avatar, AvatarFallback, AvatarImage } from "@better-update/ui/components/ui/avatar";
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
  SidebarSeparator,
  SidebarTrigger,
} from "@better-update/ui/components/ui/sidebar";
import { Skeleton } from "@better-update/ui/components/ui/skeleton";
import { TooltipProvider } from "@better-update/ui/components/ui/tooltip";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Outlet, createFileRoute, useRouter, useRouterState } from "@tanstack/react-router";
import {
  PlusIcon,
  ChevronDownIcon,
  Building2Icon,
  MonitorIcon,
  LogOutIcon,
  MoonIcon,
  SunIcon,
  CheckIcon,
  UserIcon,
} from "lucide-react";
import { Suspense, useState } from "react";

import { authClient } from "../../lib/auth-client";
import { ErrorBoundary } from "../../lib/error-boundary";
import { throwRedirect } from "../../lib/throw-redirect";
import { useTheme } from "../../lib/use-theme";
import { orgsQueryOptions, sessionQueryOptions } from "../../queries/auth";
import { CreateOrgDialog } from "./-create-org-dialog";
import { OrgNavSections, ProjectBackLink, ProjectNavSections } from "./-sidebar-nav";

import type { Theme } from "../../lib/use-theme";

const THEMES = new Set<string>(["light", "dark", "system"]);
const isTheme = (value: unknown): value is Theme => typeof value === "string" && THEMES.has(value);

const PROJECT_ID_REGEX = /^\/projects\/([^/]+)(?:\/|$)/;
const extractProjectId = (pathname: string) => {
  const match = PROJECT_ID_REGEX.exec(pathname);
  if (!match) {
    return undefined;
  }
  const [, projectId] = match;
  if (!projectId) {
    return undefined;
  }
  return projectId;
};

const getInitials = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

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
        <DropdownMenuTrigger className="w-full">
          <SidebarMenuButton size="lg" className="data-open:bg-sidebar-accent">
            <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
              <Building2Icon strokeWidth={2} className="size-4" />
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">{displayName}</span>
              <span className="text-muted-foreground truncate text-xs">{activeOrg?.slug}</span>
            </div>
            <ChevronDownIcon strokeWidth={2} className="ml-auto size-4" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" sideOffset={4} className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Organizations</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {orgs.map((org) => (
              <DropdownMenuItem key={org.id} onClick={async () => handleOrgSwitch(org.id)}>
                <Building2Icon strokeWidth={2} className="size-4" />
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

  const handleLogout = async () => {
    await authClient.signOut();
    await queryClient.resetQueries({ queryKey: ["auth"] });
    await router.navigate({ to: "/login" });
  };

  // eslint-disable-next-line eslint-js/no-restricted-syntax -- DOM prop coercion; AvatarImage src typed string | undefined
  const avatarSrc = user?.image ?? undefined;
  // eslint-disable-next-line eslint-js/no-restricted-syntax -- DOM alt attribute requires string
  const avatarAlt = user?.name ?? "";
  const initials = getInitials(user?.name ?? "U");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="w-full">
        <SidebarMenuButton size="lg" className="data-open:bg-sidebar-accent">
          <Avatar className="size-8 rounded-lg">
            <AvatarImage src={avatarSrc} alt={avatarAlt} />
            <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-semibold">{user?.name}</span>
            <span className="text-muted-foreground truncate text-xs">{user?.email}</span>
          </div>
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" sideOffset={4} className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{user?.name}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              {(() => {
                const ThemeIcon = themeIcons[theme];
                return <ThemeIcon strokeWidth={2} className="size-4" />;
              })()}
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
  <div className="mx-auto flex max-w-4xl flex-col gap-6">
    <div className="flex items-center justify-between">
      <div className="space-y-2">
        <Skeleton className="h-8 w-36 rounded-md" />
        <Skeleton className="h-5 w-72 rounded-md" />
      </div>
      <Skeleton className="h-9 w-28 rounded-md" />
    </div>
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
    <div className="pointer-events-none absolute inset-x-0 bottom-0">
      <div
        className="bg-primary h-0.5"
        style={{ animation: "progress-grow 8s cubic-bezier(0.1, 0.05, 0, 1) forwards" }}
      />
    </div>
  );
};

const AppSidebar = ({ projectId }: { projectId: string | undefined }) => (
  <Sidebar variant="inset" collapsible="icon">
    <SidebarHeader>
      <SidebarMenu>
        <SidebarMenuItem>
          <OrgSwitcher />
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>
    <SidebarSeparator />
    <SidebarContent>
      {projectId ? (
        <>
          <ProjectBackLink />
          <ProjectNavSections projectId={projectId} />
        </>
      ) : (
        <OrgNavSections />
      )}
    </SidebarContent>
    <SidebarFooter>
      <SidebarMenu>
        <SidebarMenuItem>
          <UserMenu />
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  </Sidebar>
);

const AppLayout = () => {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const projectId = extractProjectId(pathname);
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar projectId={projectId} />
        <SidebarInset>
          <header className="relative flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <NavigationProgress />
          </header>
          <main className="flex-1 p-4">
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
