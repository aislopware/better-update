import { HttpApiMiddleware, HttpApiSecurity } from "@effect/platform";
import { Schema } from "effect";

import { AuthContext } from "./context";
import { Forbidden, Unauthorized } from "./errors";

const bearerSecurity = HttpApiSecurity.bearer;
const cookieSecurity = HttpApiSecurity.apiKey({
  key: "__Secure-better-auth.session_token",
  in: "cookie",
});

/** @effect-expect-leaking HttpServerRequest | ParsedSearchParams | RouteContext */
export class Authentication extends HttpApiMiddleware.Tag<Authentication>()("api/Authentication", {
  // `Unauthorized` (401): no/invalid credential. `Forbidden` (403): a valid
  // session whose user is not yet approved by a superadmin (the dev-phase gate).
  failure: Schema.Union(Unauthorized, Forbidden),
  provides: AuthContext,
  security: { bearer: bearerSecurity, cookie: cookieSecurity },
}) {}
