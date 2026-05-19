import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/credentials")({
  component: Outlet,
});
