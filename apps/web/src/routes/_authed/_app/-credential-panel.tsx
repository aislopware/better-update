import type { ReactNode } from "react";

import { TablePanel } from "../../../components/table-panel";
import { useClientPagination } from "../../../lib/data-table";

interface CredentialPanelProps<T> {
  readonly title: string;
  readonly description: string;
  readonly items: readonly T[];
  /** Singular noun for the count line — "certificate", "key", "team". */
  readonly noun: string;
  /** What to do about the absence — shown in place of the type's description. */
  readonly emptyHint: string;
  /**
   * Say nothing at all when there is nothing. Set on the optional Apple
   * certificate types, which are gathered into one panel rather than taking a
   * card each to report their own absence.
   */
  readonly hideWhenEmpty?: boolean;
  readonly children: (pageItems: readonly T[]) => ReactNode;
}

// Most organizations use two or three of the nine credential types, so the
// unused ones are what the credentials page is mostly made of. An empty type
// states itself in its header and stops: no divider, no body row, and its own
// description gives way to the one instruction that would fill it. "None"
// carries the state so a reader scanning the left edge does not have to read
// the sentence.
const emptyMarker = <span className="text-kumo-subtle text-xs">None</span>;

/**
 * One credential type, drawn as one panel. Every section on the credentials
 * page differs only in its query and its table, so the frame, the paging and
 * the empty line are settled once here rather than nine times over.
 */
export const CredentialPanel = <T,>({
  title,
  description,
  items,
  noun,
  emptyHint,
  hideWhenEmpty = false,
  children,
}: CredentialPanelProps<T>) => {
  const pagination = useClientPagination(items, noun);
  if (items.length === 0) {
    if (hideWhenEmpty) {
      return null;
    }
    return (
      <TablePanel title={title} description={emptyHint} actions={emptyMarker}>
        {null}
      </TablePanel>
    );
  }
  return (
    <TablePanel title={title} description={description} pagination={pagination}>
      {children(pagination.pageItems)}
    </TablePanel>
  );
};
