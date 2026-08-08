import type { ReactNode } from "react";

import { PageHeader } from "./page-header";

interface ResourceListPageProps {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  /**
   * Standing context for the whole list — a reading of the period, counts,
   * where to go next. Sticks beside the list on a desktop and stacks above it
   * otherwise.
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
 *
 * The split used to wait for `2xl`, which is wider than most windows, so the
 * page it was built for spent its life stacked: a card drawn for a 300px column
 * stretched across the whole measure, labels at one end and numbers at the
 * other. It splits at `xl` on a 300px rail now, which is where the toolbar
 * beside it still fits on one line.
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
      <div className="flex flex-col-reverse gap-6 xl:flex-row xl:gap-8">
        <div className="min-w-0 grow">{children}</div>
        {/* Clears the sticky header plus the page's own top padding, so the
            rail parks exactly where the content began. */}
        <aside className="top-[calc(var(--header-height)+1.5rem)] flex h-fit w-full shrink-0 flex-col gap-4 xl:sticky xl:w-[300px]">
          {rail}
        </aside>
      </div>
    )}
  </div>
);
