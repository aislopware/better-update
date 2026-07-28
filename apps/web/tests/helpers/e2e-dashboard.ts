import {
  seedServerE2ESql,
  serverE2EBaseUrl,
} from "../../../server/tests/helpers/e2e-harness-client";
import { webE2EBaseUrl } from "./e2e-shared-env";

const parseCookies = (response: Response): string => {
  const raw = response.headers.get("set-cookie") ?? "";
  if (!raw) {
    return "";
  }
  return raw
    .split(/, (?=\w+=)/)
    .map((cookie) => cookie.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
};

// better-auth force-validates the Origin as soon as a request carries any
// Sec-Fetch-* hint, and Node's fetch always sends `sec-fetch-mode: cors`.
// Without an Origin these calls get 403 MISSING_OR_NULL_ORIGIN; the web origin
// is the trusted one (it is better-auth's baseURL under the e2e env), so send
// it and look like the browser calls these stand in for.
const withOrigin = (headers?: Record<string, string>): Record<string, string> => ({
  origin: webE2EBaseUrl(),
  ...headers,
});

export const setupE2EDashboard = () => {
  const post = async (path: string, body: unknown, headers?: Record<string, string>) =>
    fetch(`${webE2EBaseUrl()}${path}`, {
      method: "POST",
      headers: withOrigin({ "content-type": "application/json", ...headers }),
      body: JSON.stringify(body),
    });

  const get = async (path: string, headers?: Record<string, string>) =>
    fetch(`${webE2EBaseUrl()}${path}`, { headers: withOrigin(headers) });

  const del = async (path: string, body: unknown, headers?: Record<string, string>) =>
    fetch(`${webE2EBaseUrl()}${path}`, {
      method: "DELETE",
      headers: withOrigin({ "content-type": "application/json", ...headers }),
      body: JSON.stringify(body),
    });

  const patch = async (path: string, body: unknown, headers?: Record<string, string>) =>
    fetch(`${webE2EBaseUrl()}${path}`, {
      method: "PATCH",
      headers: withOrigin({ "content-type": "application/json", ...headers }),
      body: JSON.stringify(body),
    });

  // The harness keeps D1 in memory inside the globalSetup process, so seeding no
  // longer shells out to `wrangler d1 execute --persist-to` (one subprocess per
  // call, and a temp .sql file that had to be uniquely named to survive
  // concurrent e2e-api files). Post the SQL to the stack's control plane
  // instead — no subprocess, no temp file, no cross-process race.
  const seedSql = seedServerE2ESql;

  return {
    getBaseUrl: webE2EBaseUrl,
    getWorkerUrl: serverE2EBaseUrl,
    post,
    get,
    del,
    patch,
    seedSql,
    parseCookies,
  };
};
