import { Outlet, createFileRoute } from "@tanstack/react-router";

/**
 * The account area is a section of the dashboard, not a page with a nav bolted
 * to its side: its sections live in the app sidebar (see `-sidebar-nav`), so
 * this layout only has to hold the page.
 *
 * Capped to a readable measure, like the two settings pages — every page under
 * here is a column of cards over form fields, and a field stretched across a
 * 1400px monitor is not easier to fill in.
 */
const AccountLayout = () => (
  <div className="flex w-full max-w-3xl flex-col gap-6">
    <Outlet />
  </div>
);

export const Route = createFileRoute("/_authed/_app/account")({
  component: AccountLayout,
});
