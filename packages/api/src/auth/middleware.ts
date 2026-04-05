import { HttpApiMiddleware, HttpApiSecurity } from "@effect/platform";

import { AuthContext } from "./context";
import { Unauthorized } from "./errors";

const bearerSecurity = HttpApiSecurity.bearer;
const cookieSecurity = HttpApiSecurity.apiKey({
  key: "__Secure-better-auth.session_token",
  in: "cookie",
});

export class Authentication extends HttpApiMiddleware.Tag<Authentication>()("api/Authentication", {
  failure: Unauthorized,
  provides: AuthContext,
  security: { bearer: bearerSecurity, cookie: cookieSecurity },
}) {}
