import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/_app/account/")({
  beforeLoad: () => {
    // eslint-disable-next-line functional/no-throw-statements, typescript/only-throw-error -- TanStack Router idiom
    throw redirect({ to: "/account/profile" });
  },
});
