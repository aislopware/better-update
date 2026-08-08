import type { ReactNode } from "react";

import {
  ClientPaginationBar,
  ListPanel,
  ListPanelFooter,
  ListPanelHeader,
} from "../lib/data-table";

import type { ClientPaginationState } from "../lib/data-table";

/**
 * Panel title carrying the glyph of the thing it lists — the mark a detail page
 * uses to tell two stacked panels apart at a glance, where a list page can rely
 * on its own header instead.
 */
export const PanelTitle = ({ icon, label }: { icon: ReactNode; label: ReactNode }) => (
  <span className="flex items-center gap-2">
    <span className="text-kumo-subtle flex items-center [&>svg]:size-4">{icon}</span>
    {label}
  </span>
);

interface TablePanelProps {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** Controls for the panel as a whole — parked at the top-right of its header. */
  readonly actions?: ReactNode;
  /** Full-bleed body: a table, a list of rows, or an empty state. */
  readonly children: ReactNode;
  /**
   * Count line and page controls, drawn in the closing bar. Omitted for an
   * empty panel, which has no count worth closing on.
   */
  readonly pagination?: ClientPaginationState<unknown> | undefined;
  /** Closing bar for a panel that pages nothing — a note, a caveat, a total. */
  readonly footer?: ReactNode;
  readonly className?: string;
}

/**
 * A titled list, drawn as one object: the name and the rows it names share a
 * surface, with a divider between them and the count closing the bottom.
 *
 * Replaces the older shape — a `SectionHeader` floating above a separately
 * bordered table — which drew a page of eight lists as sixteen loose parts. The
 * Cloudflare dashboard keeps the header, the rows and the count inside one
 * frame, so the page reads as a stack of panels rather than a stack of
 * fragments.
 */
export const TablePanel = ({
  title,
  description,
  actions,
  children,
  pagination,
  footer,
  className,
}: TablePanelProps) => (
  <ListPanel className={className}>
    <ListPanelHeader title={title} description={description} actions={actions} />
    {children}
    {pagination ? (
      <ListPanelFooter>
        <ClientPaginationBar state={pagination} />
      </ListPanelFooter>
    ) : null}
    {pagination === undefined && footer ? <ListPanelFooter>{footer}</ListPanelFooter> : null}
  </ListPanel>
);
