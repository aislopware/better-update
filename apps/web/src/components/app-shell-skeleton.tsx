import { Skeleton } from "@better-update/ui/components/skeleton";

import { DetailCardSkeleton } from "./skeletons";

const SIDEBAR_ROWS = [0, 1, 2, 3, 4, 5, 6] as const;

// Static mirror of the real authed shell in routes/_authed/_app.tsx (Kumo
// `Sidebar.Provider` + expanded `Sidebar` + main column). Plain divs only —
// widths/heights match the live shell: Kumo's 16.25rem sidebar with border-r,
// a header row and a footer strip of the same heights, flex header with
// switcher + breadcrumbs left / search + account right, px-4 py-6 lg:px-6
// lg:py-8 main.
export const AppShellSkeleton = () => (
  <div className="bg-kumo-base flex min-h-svh w-full">
    <aside className="border-kumo-line hidden w-[16.25rem] shrink-0 flex-col border-r md:flex">
      <div className="border-kumo-line flex h-(--header-height) shrink-0 items-center gap-2.5 border-b px-4">
        <Skeleton className="size-8 rounded-lg" />
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-2.5 w-16" />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 px-3.5 py-3">
        {SIDEBAR_ROWS.map((key) => (
          <Skeleton key={key} className="h-8.5 w-full rounded-lg" />
        ))}
      </div>
      <div className="border-kumo-line flex h-12 shrink-0 items-center border-t px-4">
        <Skeleton className="size-5 rounded-sm" />
      </div>
    </aside>
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="border-kumo-line flex h-(--header-height) shrink-0 items-center justify-between gap-2 border-b px-4 lg:px-6">
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-32 rounded-md" />
          <Skeleton className="hidden h-4 w-24 md:block" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="size-8 rounded-lg sm:h-8 sm:w-48" />
          <Skeleton className="size-8 rounded-lg" />
        </div>
      </header>
      <main className="flex-1 px-4 py-6 lg:px-6 lg:py-8">
        <DetailCardSkeleton rows={3} columns={2} />
      </main>
    </div>
  </div>
);
