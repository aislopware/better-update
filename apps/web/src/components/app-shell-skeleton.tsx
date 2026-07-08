import { Skeleton } from "@better-update/ui/components/ui/skeleton";

import { DetailCardSkeleton } from "./skeletons";

const SIDEBAR_ROWS = [0, 1, 2, 3, 4, 5, 6] as const;

// Static mirror of the real authed shell in routes/_authed/_app.tsx
// (SidebarProvider + default-variant Sidebar + SidebarInset, shadcn sidebar-01
// style). Plain divs only — widths/heights match the live shell:
// --sidebar-width 16rem (w-64) with border-r, header-height sidebar header,
// flex header with switcher + breadcrumbs left / search right,
// px-4 py-6 lg:px-6 lg:py-8 main.
export const AppShellSkeleton = () => (
  <div className="bg-background flex min-h-svh w-full">
    <aside className="bg-sidebar hidden w-64 shrink-0 flex-col gap-2 border-r md:flex">
      <div className="flex h-(--header-height) shrink-0 flex-col justify-center gap-2 p-2">
        <div className="flex items-center gap-2 p-2">
          <Skeleton className="size-8 rounded-lg" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-2.5 w-16" />
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-1 p-2">
        {SIDEBAR_ROWS.map((key) => (
          <Skeleton key={key} className="h-8 w-full rounded-md" />
        ))}
      </div>
      <div className="mt-auto flex items-center gap-2 p-4">
        <Skeleton className="size-8 rounded-full" />
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-2.5 w-28" />
        </div>
      </div>
    </aside>
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-(--header-height) shrink-0 items-center justify-between gap-2 border-b px-4 lg:px-6">
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-32 rounded-md" />
          <Skeleton className="hidden h-4 w-24 md:block" />
        </div>
        <Skeleton className="size-8 rounded-lg sm:h-8 sm:w-48" />
      </header>
      <main className="flex-1 px-4 py-6 lg:px-6 lg:py-8">
        <DetailCardSkeleton rows={3} columns={2} />
      </main>
    </div>
  </div>
);
