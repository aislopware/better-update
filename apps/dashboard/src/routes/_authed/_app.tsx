import { Avatar, AvatarFallback, AvatarImage } from "@better-update/ui/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@better-update/ui/components/ui/dropdown-menu";
import { Separator } from "@better-update/ui/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
} from "@better-update/ui/components/ui/sidebar";
import { TooltipProvider } from "@better-update/ui/components/ui/tooltip";
import {
  Folder02Icon,
  Settings02Icon,
  Logout03Icon,
  ArrowDown01Icon,
  Building06Icon,
  Tick02Icon,
  Add01Icon,
  UserGroupIcon,
  Key01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, Outlet, createFileRoute, redirect, useRouter } from "@tanstack/react-router";

import { authClient } from "../../lib/auth-client";
import { orgsQueryOptions, sessionQueryOptions } from "../../queries/auth";

const navItems = [
  { to: "/projects", label: "Projects", icon: Folder02Icon },
  { to: "/members", label: "Members", icon: UserGroupIcon },
  { to: "/api-keys", label: "API Keys", icon: Key01Icon },
  { to: "/settings", label: "Settings", icon: Settings02Icon },
] as const;

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
  const { data: orgs } = useSuspenseQuery(orgsQueryOptions);
  const { data: session } = useSuspenseQuery(sessionQueryOptions);
  const activeOrgId = session?.user.activeOrganizationId;
  const activeOrg = orgs.find((org) => org.id === activeOrgId) ?? orgs[0];

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
    <DropdownMenu>
      <DropdownMenuTrigger className="w-full">
        <SidebarMenuButton size="lg" className="data-open:bg-sidebar-accent">
          <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
            <HugeiconsIcon icon={Building06Icon} strokeWidth={2} className="size-4" />
          </div>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-semibold">{activeOrg?.name ?? "No org"}</span>
            <span className="text-muted-foreground truncate text-xs">{activeOrg?.slug ?? ""}</span>
          </div>
          <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="ml-auto size-4" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" sideOffset={4} className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Organizations</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {orgs.map((org) => (
            <DropdownMenuItem key={org.id} onClick={async () => handleOrgSwitch(org.id)}>
              <HugeiconsIcon icon={Building06Icon} strokeWidth={2} className="size-4" />
              <span className="flex-1 truncate">{org.name}</span>
              {org.id === activeOrgId ? (
                <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} className="text-primary size-4" />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-4" />
          <span>Create organization</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const UserMenu = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session } = useSuspenseQuery(sessionQueryOptions);
  const user = session?.user;

  const handleLogout = async () => {
    await authClient.signOut();
    await queryClient.resetQueries({ queryKey: ["auth"] });
    await router.navigate({ to: "/login" });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="w-full">
        <SidebarMenuButton size="lg" className="data-open:bg-sidebar-accent">
          <Avatar className="size-8 rounded-lg">
            <AvatarImage src={user?.image ?? undefined} alt={user?.name ?? ""} />
            <AvatarFallback className="rounded-lg">{getInitials(user?.name ?? "U")}</AvatarFallback>
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
          <DropdownMenuItem onClick={handleLogout}>
            <HugeiconsIcon icon={Logout03Icon} strokeWidth={2} className="size-4" />
            <span>Log out</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const NavGroup = () => (
  <SidebarGroup>
    <SidebarGroupLabel>Platform</SidebarGroupLabel>
    <SidebarGroupContent>
      <SidebarMenu>
        {navItems.map((item) => (
          <SidebarMenuItem key={item.to}>
            <Link to={item.to}>
              {({ isActive }) => (
                <SidebarMenuButton isActive={isActive} tooltip={item.label}>
                  <HugeiconsIcon icon={item.icon} strokeWidth={2} />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              )}
            </Link>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroupContent>
  </SidebarGroup>
);

const AppSidebar = () => (
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
      <NavGroup />
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

const AppLayout = () => (
  <TooltipProvider>
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
        </header>
        <main className="flex-1 p-4">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  </TooltipProvider>
);

export const Route = createFileRoute("/_authed/_app")({
  beforeLoad: ({ context }) => {
    if (context.orgs.length === 0) {
      throw redirect({ to: "/onboarding" });
    }

    const activeOrgId = context.session?.user.activeOrganizationId;
    const activeOrg = context.orgs.find((org) => org.id === activeOrgId) ?? context.orgs[0];

    return { activeOrg };
  },
  component: AppLayout,
});
