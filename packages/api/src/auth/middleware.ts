import { HttpApiMiddleware, HttpApiSecurity } from "effect/unstable/httpapi";

import { Forbidden, Unauthorized } from "./errors";

import type { AuthContext } from "./context";

const bearerSecurity = HttpApiSecurity.bearer;
const cookieSecurity = HttpApiSecurity.apiKey({
  key: "__Secure-better-auth.session_token",
  in: "cookie",
});

/** @effect-expect-leaking HttpServerRequest | ParsedSearchParams | RouteContext */
export class Authentication extends HttpApiMiddleware.Service<
  Authentication,
  { provides: AuthContext }
>()("api/Authentication", {
  // `Unauthorized` (401): no/invalid credential. `Forbidden` (403): a valid
  // session whose user is not yet approved by a superadmin (the dev-phase gate).
  error: [Unauthorized, Forbidden],
  security: { bearer: bearerSecurity, cookie: cookieSecurity },
}) {}
