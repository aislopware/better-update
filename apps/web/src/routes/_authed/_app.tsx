import { Button } from "@better-update/ui/components/button";
import { DropdownMenu } from "@better-update/ui/components/dropdown";
import { inputVariants } from "@better-update/ui/components/input";
import { Kbd } from "@better-update/ui/components/kbd";
import { Loader } from "@better-update/ui/components/loader";
import { Sidebar } from "@better-update/ui/components/sidebar";
import { Skeleton } from "@better-update/ui/components/skeleton";
import { TooltipProvider } from "@better-update/ui/components/tooltip";
import { cn } from "@better-update/ui/lib/utils";
import {
  CaretUpDownIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  SignOutIcon,
  UserIcon,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  createFileRoute,
  redirect,
  useChildMatches,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
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
import { AccountNavSections, OrgNavSections, ProjectNavSections } from "./-sidebar-nav";
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

// Sits in the sidebar header, so it has to survive the collapse: the avatar is
// the only part that stays, and the label column is what the shrinking width
// clips away.
const renderOrgTrigger = (
  name: string,
  slug: string | undefined,
  image: string | null | undefined,
) => (
  <button
    type="button"
    aria-label="Switch organization"
    className="hover:bg-kumo-tint data-[popup-open]:bg-kumo-tint focus-visible:ring-kumo-brand flex h-10 w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg px-1 text-left outline-none focus-visible:ring-2"
  >
    <EntityAvatar
      name={name}
      seed={slug ?? name}
      image={image}
      shape="square"
      className="size-8 shrink-0"
    />
    <div className="grid min-w-0 flex-1 leading-tight">
      <span className="truncate text-sm font-medium">{name}</span>
      <span className="text-kumo-subtle truncate text-xs">{slug}</span>
    </div>
    <CaretUpDownIcon weight="bold" className="text-kumo-subtle size-3.5 shrink-0" />
  </button>
);

// Top-right, the way the Cloudflare dashboard carries the account menu: the
// avatar is the constant, the name appears once there is room for it.
const renderUserTrigger = (name: string | undefined, image: string | null | undefined) => (
  <Button variant="ghost" aria-label="Account" className="h-8 gap-2 px-1.5">
    <EntityAvatar name={name ?? "U"} image={image} size="sm" />
    <span className="hidden max-w-32 truncate font-normal lg:inline">{name}</span>
    <CaretUpDownIcon weight="bold" className="text-kumo-subtle size-3 shrink-0" />
  </Button>
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
        <DropdownMenu.Trigger
          render={renderOrgTrigger(displayName, activeOrg.slug, activeOrg.logo)}
        />
        {/* Default w-(--anchor-width) matches the expanded trigger (canonical
            team-switcher look); min-w keeps it usable in icon-collapsed mode. */}
        <DropdownMenu.Content align="start" side="bottom" sideOffset={4} className="min-w-56">
          <DropdownMenu.Group>
            <DropdownMenu.Label>Organizations</DropdownMenu.Label>
            <DropdownMenu.Separator />
            {orgs.map((org) => {
              const isSwitching = switchingOrgId === org.id;
              const isActive = org.id === activeOrgId;
              return (
                <DropdownMenu.Item
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
                </DropdownMenu.Item>
              );
            })}
          </DropdownMenu.Group>
          <DropdownMenu.Separator />
          <DropdownMenu.Item
            onClick={() => {
              setCreateOrgOpen(true);
            }}
            disabled={switchOrg.isPending}
          >
            <PlusIcon weight="bold" className="size-4" />
            <span>Create organization</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
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
      <DropdownMenu.Trigger render={renderUserTrigger(user.name, user.image)} />
      <DropdownMenu.Content align="end" side="bottom" sideOffset={4} className="min-w-56">
        <DropdownMenu.Group>
          {/* Canonical nav-user label block: avatar + name + email. */}
          <DropdownMenu.Label className="p-0 font-normal">
            <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
              <EntityAvatar name={user.name || "U"} image={user.image} className="size-8" />
              <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                <span className="text-kumo-strong truncate font-medium">{user.name}</span>
                <span className="text-kumo-subtle truncate text-xs">{user.email}</span>
              </div>
            </div>
          </DropdownMenu.Label>
          <DropdownMenu.Separator />
          <DropdownMenu.Item
            onClick={async () => {
              await router.navigate({ to: "/account/profile" });
            }}
            disabled={logoutMutation.isPending}
          >
            <UserIcon weight="bold" className="size-4" />
            <span>Account</span>
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item
            variant="danger"
            onClick={() => {
              logoutMutation.mutate();
            }}
            disabled={logoutMutation.isPending}
            closeOnClick={false}
          >
            {logoutMutation.isPending ? (
              <Loader size={16} />
            ) : (
              <SignOutIcon weight="bold" className="size-4" />
            )}
            <span>{logoutMutation.isPending ? "Logging out…" : "Log out"}</span>
          </DropdownMenu.Item>
        </DropdownMenu.Group>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
};

/**
 * ⌘K entry point, sitting directly under the org switcher the way the Cloudflare
 * dashboard carries it — search is a way of navigating, so it belongs with the
 * nav rather than in the header opposite the account menu.
 *
 * Dressed as a search field, not as a nav row: a row that looks like every other
 * row reads as a destination, while a field announces that typing is the point.
 * The dressing is Kumo's own `inputVariants()`, so the box is the same height,
 * radius, fill and hairline as a real input rather than a hand-tuned lookalike.
 * It stays a button underneath — the palette owns the actual text field.
 *
 * Collapsed, there is no room for a field, so it becomes the square icon button
 * the rest of the rail is made of.
 */
const SidebarSearchButton = ({ onClick }: { onClick: () => void }) => (
  <Sidebar.Group>
    <button
      type="button"
      onClick={onClick}
      className={cn(
        inputVariants(),
        "hover:bg-kumo-control-hover flex w-full cursor-pointer items-center",
        "group-data-[state=collapsed]/sidebar:size-8 group-data-[state=collapsed]/sidebar:justify-center group-data-[state=collapsed]/sidebar:self-center group-data-[state=collapsed]/sidebar:px-0",
      )}
    >
      <MagnifyingGlassIcon className="text-kumo-subtle size-4 shrink-0" />
      {/* The label carries placeholder weight, not body weight — it is a prompt,
          not content. Both it and the hint go with the rail when it collapses. */}
      <span className="text-kumo-subtle flex-1 truncate text-left group-data-[state=collapsed]/sidebar:hidden">
        Quick search…
      </span>
      <Kbd className="group-data-[state=collapsed]/sidebar:hidden">⌘K</Kbd>
    </button>
  </Sidebar.Group>
);

/**
 * Whichever set of places you are among: a project's, the account's, or the
 * organization's. One rail, never two — the account area used to stand its own
 * nav column beside this one.
 */
const SidebarSections = ({
  projectSlug,
  isAccount,
  isSuperadmin,
}: {
  projectSlug: string | undefined;
  isAccount: boolean;
  isSuperadmin: boolean;
}) => {
  if (projectSlug) {
    return <ProjectNavSections projectSlug={projectSlug} />;
  }
  if (isAccount) {
    return <AccountNavSections />;
  }
  return <OrgNavSections isSuperadmin={isSuperadmin} />;
};

const AppSidebar = ({
  projectSlug,
  isAccount,
  isSuperadmin,
  onSearch,
}: {
  projectSlug: string | undefined;
  isAccount: boolean;
  isSuperadmin: boolean;
  onSearch: () => void;
}) => (
  // Pinned to the viewport so the nav stays put while a long page scrolls;
  // Kumo's own root is `h-full`, which would let it scroll away with the page.
  <Sidebar
    className="sticky top-0 z-40 h-svh self-start"
    // A peek floats the nav over the page rather than pushing it, so it needs
    // the elevation to read as a layer above rather than a slice out of it.
    contentClassName="group-data-[state=peeking]/sidebar:shadow-2xl"
  >
    {/* Matched to the header row so the org trigger lines up with the
        breadcrumb bar and the nav starts under one continuous divider. The
        padding tracks Sidebar.Content's, which narrows as the rail collapses. */}
    <Sidebar.Header className="h-(--header-height) px-2.5 group-not-data-[state=collapsed]/sidebar:px-3">
      <OrgSwitcher />
    </Sidebar.Header>
    <Sidebar.Content>
      <SidebarSearchButton onClick={onSearch} />
      <SidebarSections
        projectSlug={projectSlug}
        isAccount={isAccount}
        isSuperadmin={isSuperadmin}
      />
    </Sidebar.Content>
    <Sidebar.Footer>
      <Sidebar.Trigger />
    </Sidebar.Footer>
  </Sidebar>
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
      {/* Peekable: hovering the collapsed rail floats the full nav back over
          the page, so collapsing costs nothing to navigate from. */}
      <Sidebar.Provider peekable>
        <AppSidebar
          projectSlug={projectSlug}
          isAccount={pathname === "/account" || pathname.startsWith("/account/")}
          isSuperadmin={isSuperadmin}
          onSearch={() => {
            setCommandOpen(true);
          }}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Location on the left, account on the right, and nothing else — the
              Cloudflare header is a place marker, not a toolbar. Search moved
              into the nav, so the right side is the account menu alone. */}
          <header className="bg-kumo-base/80 border-kumo-line sticky top-0 z-30 flex h-(--header-height) shrink-0 items-center justify-between gap-2 border-b px-4 backdrop-blur lg:px-6">
            <div className="flex min-w-0 items-center gap-1">
              {/* Below Kumo's 768px breakpoint the sidebar is an offcanvas
                  sheet, so its own footer trigger is off screen. */}
              <Sidebar.Trigger className="-ml-1 md:hidden" />
              <Suspense fallback={<Skeleton className="h-7 w-32 rounded-md" />}>
                <ProjectSwitcher orgId={activeOrg.id} currentProjectSlug={projectSlug} />
              </Suspense>
              <HeaderBreadcrumbs projectSlug={projectSlug} />
            </div>
            <UserMenu />
          </header>
          {/* The measure is Kumo's own: past ~1400px a table stops being
              readable and starts being a stretch, so the page centres rather
              than filling whatever width the monitor has. Padding follows the
              same ladder its page blocks use. */}
          <main className="min-w-0 flex-1">
            <div className="mx-auto w-full max-w-[1400px] p-6 md:p-8 lg:px-10 lg:py-9">
              <ErrorBoundary key={pathname}>
                <Suspense fallback={<DetailCardSkeleton rows={3} columns={2} />}>
                  <Outlet />
                </Suspense>
              </ErrorBoundary>
            </div>
          </main>
        </div>
        <CommandPalette
          open={commandOpen}
          onOpenChange={setCommandOpen}
          orgId={activeOrg.id}
          projectSlug={projectSlug}
          isSuperadmin={isSuperadmin}
        />
      </Sidebar.Provider>
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
