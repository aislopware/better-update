/**
 * The chrome a full-bleed row inside a panel wears when the whole row is a
 * link — everything except how it lays its own contents out, which is the
 * row's business (a grid here, a flex row there).
 *
 * Written once because it was being written six times and never the same way:
 * three rows carried a focus ring and three had none at all, so on those the
 * only thing a keyboard reader got was whatever the browser draws by default —
 * clipped, because these rows reach the edges of a rounded panel that hides its
 * overflow. The hover surface disagreed too, `tint` in some and `tint/50` in
 * the rest. Both settle on what Kumo's own `Item` does.
 *
 * The ring is inset for that same clipping: drawn outside the row, as a ring
 * normally is, it would be cut off left and right and vanish altogether on the
 * first and last row of a panel.
 */
export const ROW_LINK =
  "hover:bg-kumo-tint focus-visible:ring-kumo-focus no-underline outline-none focus-visible:ring-2 focus-visible:ring-inset";

/** `ROW_LINK` for a list that rules its own rows rather than dividing them. */
export const ROW_LINK_DIVIDED = `${ROW_LINK} border-kumo-line border-b last:border-0`;

/**
 * The way out of a panel to the full list it previews: "View all", "N more".
 *
 * Quiet, because it is an exit and not the content — but it is still a link,
 * so it says where focus is. Belongs in the panel header rather than under the
 * rows: the closing bar counts how much of the set is on screen, and a way out
 * is not a fact about the set. That is where the Cloudflare dashboard puts it.
 *
 * Written seven ways before this: six copies of the same three utilities, one
 * of which had thought to add `no-underline`, and none of which had a focus
 * ring at all.
 */
export const VIEW_ALL_LINK =
  "text-kumo-subtle hover:text-kumo-default focus-visible:ring-kumo-focus rounded-sm text-sm no-underline outline-none focus-visible:ring-2";
