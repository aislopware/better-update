import { CaretRightIcon } from "@phosphor-icons/react";

/**
 * The chevron that closes a row you can click through: absent until the row is
 * pointed at or focus lands inside it, so a list of twenty is not a column of
 * twenty arrows.
 *
 * Decoration — the row is already a link and says where it goes — so it is
 * hidden from the accessibility tree rather than named.
 *
 * Wants a `group/row` on the row itself; `ROW_LINK` rows and the data table's
 * own rows both set one.
 */
export const RowCaret = () => (
  <CaretRightIcon
    aria-hidden
    weight="bold"
    className="text-kumo-subtle size-4 opacity-0 transition-opacity duration-(--duration-quick) group-focus-within/row:opacity-100 group-hover/row:opacity-100"
  />
);
