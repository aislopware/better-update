import type { ReactNode } from "react";

import { PageHeader } from "./page-header";

interface ResourceListPageProps {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  /**
   * Standing context for the whole list — counts, limits, where to go next.
   * Sticks beside the list on wide screens and drops below it otherwise, so it
   * is never the first thing a narrow window shows.
   */
  readonly rail?: ReactNode;
  readonly children: ReactNode;
}

/**
 * The shape of a list page in the Cloudflare dashboard, and Kumo's own
 * `ResourceListPage` block: title, one line of description, then the list with
 * a column of context pinned beside it.
 *
 * The measure and the page padding are the app shell's — this only owns the
 * split. `flex-col-reverse` is what puts the list first on a phone while the
 * rail still reads as the right-hand column on a desktop.
 */
export const ResourceListPage = ({
  title,
  description,
  actions,
  rail,
  children,
}: ResourceListPageProps) => (
  <div className="flex w-full flex-col gap-6">
    <PageHeader title={title} description={description} actions={actions} />
    {rail === undefined ? (
      children
    ) : (
      // Kumo's own block splits at `xl`, but its list pages carry no filter
      // toolbar; ours does, and 1280px minus the nav minus a rail leaves the
      // toolbar too little to stay on one line, so the split waits for `2xl`.
      // Below it the rail stacks *above* the list rather than under it —
      // standing context is worth nothing at the bottom of a long page.
      <div className="flex flex-col-reverse gap-6 2xl:flex-row 2xl:gap-8">
        <div className="min-w-0 grow">{children}</div>
        {/* Clears the sticky header plus the page's own top padding, so the
            rail parks exactly where the content began. */}
        <aside className="top-[calc(var(--header-height)+1.5rem)] flex h-fit w-full shrink-0 flex-col gap-4 2xl:sticky 2xl:w-[340px]">
          {rail}
        </aside>
      </div>
    )}
  </div>
);
