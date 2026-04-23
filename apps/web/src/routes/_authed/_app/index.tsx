import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/_app/")({
  beforeLoad: () => {
    // eslint-disable-next-line functional/no-throw-statements, typescript/only-throw-error -- TanStack Router idiom: throw redirect preserves typed `to` inference
    throw redirect({ to: "/projects" });
  },
});
