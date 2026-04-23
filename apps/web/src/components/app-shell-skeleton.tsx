import { Skeleton } from "@better-update/ui/components/ui/skeleton";

const SIDEBAR_ROWS = [0, 1, 2, 3, 4] as const;

export const AppShellSkeleton = () => (
  <div className="bg-sidebar flex min-h-dvh">
    <aside className="border-border/60 hidden w-64 shrink-0 flex-col gap-4 border-r p-4 md:flex">
      <div className="flex items-center gap-3">
        <Skeleton className="size-8 rounded-md" />
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-3 w-24 rounded" />
          <Skeleton className="h-2.5 w-16 rounded" />
        </div>
      </div>
      <div className="flex flex-col gap-1 pt-4">
        {SIDEBAR_ROWS.map((key) => (
          <Skeleton key={key} className="h-8 w-full rounded-md" />
        ))}
      </div>
      <div className="mt-auto flex items-center gap-3">
        <Skeleton className="size-8 rounded-full" />
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-3 w-20 rounded" />
          <Skeleton className="h-2.5 w-28 rounded" />
        </div>
      </div>
    </aside>
    <div className="flex flex-1 flex-col">
      <header className="border-border/60 flex h-12 items-center gap-3 border-b px-4">
        <Skeleton className="h-4 w-40 rounded" />
      </header>
      <main className="flex-1 p-4 md:p-6">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-9 w-56 rounded-md" />
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </main>
    </div>
  </div>
);
