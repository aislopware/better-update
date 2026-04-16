import { redirect } from "@tanstack/react-router";

// eslint-disable-next-line func-style -- function declaration required for TS control-flow narrowing through `never` return at call sites; arrow and function expression forms fail to narrow.
export function throwRedirect(opts: Parameters<typeof redirect>[0]): never {
  // eslint-disable-next-line functional/no-throw-statements, typescript/only-throw-error -- TanStack Router idiom: a Redirect Response is intentionally thrown (not an Error) to short-circuit beforeLoad/loader. Consolidated here so route files avoid scattered per-file disables.
  throw redirect(opts);
}
