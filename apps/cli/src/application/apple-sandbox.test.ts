import { generateKeyPairSync } from "node:crypto";

import { Effect } from "effect";

import { decodeSandboxTestersV2Page, listSandboxTestersV2 } from "./apple-sandbox";

import type { FetchFn } from "../lib/asc-build-upload";

/** A full v2 resource, including the v2-only attributes the CLI ignores. */
const v2Tester = (id: string, email: string) => ({
  type: "sandboxTesters",
  id,
  attributes: {
    firstName: "Test",
    lastName: id.toUpperCase(),
    acAccountName: email,
    territory: "USA",
    applePayCompatible: true,
    interruptPurchases: false,
    subscriptionRenewalRate: "MONTHLY_RENEWAL_EVERY_FIVE_MINUTES",
  },
});

describe(decodeSandboxTestersV2Page, () => {
  it("maps v2 attributes onto the cookie-path view shape, ignoring v2-only extras", () => {
    const page = Effect.runSync(
      decodeSandboxTestersV2Page({
        data: [v2Tester("t1", "one@example.com")],
        links: { self: "https://api/self", next: "https://api/next" },
        meta: { paging: { total: 1, limit: 200 } },
      }),
    );
    expect(page.testers).toStrictEqual([
      {
        id: "t1",
        email: "one@example.com",
        firstName: "Test",
        lastName: "T1",
        territory: "USA",
        applePayCompatible: true,
      },
    ]);
    expect(page.nextUrl).toBe("https://api/next");
  });

  it("renders empty values for absent attributes and treats a null next link as exhausted", () => {
    const page = Effect.runSync(
      decodeSandboxTestersV2Page({
        data: [{ type: "sandboxTesters", id: "bare" }],
        links: { next: null },
      }),
    );
    expect(page.testers).toStrictEqual([
      {
        id: "bare",
        email: "",
        firstName: "",
        lastName: "",
        territory: null,
        applePayCompatible: false,
      },
    ]);
    expect(page.nextUrl).toBeUndefined();
  });

  it("fails on an unexpected response shape", () => {
    expect(() => Effect.runSync(decodeSandboxTestersV2Page("not json:api"))).toThrow(
      /unexpected response shape/,
    );
  });
});

// ── Pagination against a scripted fetch (real ES256 key, real JWT) ───────────

const P8_PEM = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({
  type: "pkcs8",
  format: "pem",
});

const credentials = { keyId: "KEY123", issuerId: "ISSUER-UUID", p8Pem: P8_PEM };

const json = (status: number, body: unknown): Response => Response.json(body, { status });

describe(listSandboxTestersV2, () => {
  it("requests limit=200 with a Bearer JWT and drains every page via links.next", async () => {
    const calls: { url: string; authorization: string | undefined }[] = [];
    const page2Url = "https://api.appstoreconnect.apple.com/v2/sandboxTesters?cursor=abc&limit=200";
    const fetchFn: FetchFn = async (url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url, authorization: headers["authorization"] });
      return url === page2Url
        ? json(200, { data: [v2Tester("t3", "three@example.com")] })
        : json(200, {
            data: [v2Tester("t1", "one@example.com"), v2Tester("t2", "two@example.com")],
            links: { next: page2Url },
          });
    };

    const testers = await Effect.runPromise(listSandboxTestersV2({ credentials, fetchFn }));

    expect(testers.map((tester) => tester.id)).toStrictEqual(["t1", "t2", "t3"]);
    expect(calls.map((call) => call.url)).toStrictEqual([
      "https://api.appstoreconnect.apple.com/v2/sandboxTesters?limit=200",
      page2Url,
    ]);
    expect(calls[0]?.authorization).toMatch(/^Bearer /u);
  });

  it("fails with the ASC error detail on a non-200 so the caller can fall back", async () => {
    const fetchFn: FetchFn = async () =>
      json(401, { errors: [{ status: "401", code: "NOT_AUTHORIZED", detail: "expired token" }] });

    await expect(Effect.runPromise(listSandboxTestersV2({ credentials, fetchFn }))).rejects.toThrow(
      /returned 401: expired token/u,
    );
  });
});
