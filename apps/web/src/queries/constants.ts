/**
 * Max items fetched when populating a picker's default list from a paginated
 * API. Pickers must stay reachable beyond this page — use `useServerSearchList`
 * / `ServerSearchCombobox` (components/server-search-combobox) so typing
 * searches server-side instead of filtering the first page.
 */
export const DROPDOWN_FETCH_LIMIT = 100;
