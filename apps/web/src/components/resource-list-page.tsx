import type { ReactNode } from "react";

import { PageHeader } from "./page-header";

interface ResourceListPageProps {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}

/**
 * The shape of a list page in the Cloudflare dashboard, and Kumo's own
 * `ResourceListPage` block: title, one line of description, then the list.
 *
 * The measure and the page padding are the app shell's.
 *
 * There used to be a rail here — a sticky right-hand column of standing
 * context, which only split off above 2xl. Under that width it stacked across
 * the whole page, where a card built for 340px put its labels and its numbers a
 * thousand pixels apart, and the one page that used it now opens on the same
 * activity panel the overviews do.
 */
export const ResourceListPage = ({
  title,
  description,
  actions,
  children,
}: ResourceListPageProps) => (
  <div className="flex w-full flex-col gap-6">
    <PageHeader title={title} description={description} actions={actions} />
    {children}
  </div>
);
