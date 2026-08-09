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
