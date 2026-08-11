import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import type { RequestContext } from "@expo/apple-utils";

import { listFeedback, resolveFeedbackBuildId } from "./testflight-feedback";

import type { FetchFn } from "../lib/asc-build-upload";

/** A signed-token context; `RequestContext.token` accepts a pre-signed JWT string. */
const ctx = { token: "test-jwt" } as RequestContext;

const submission = (id: string, createdDate: string, overrides: Record<string, unknown> = {}) => ({
  id,
  attributes: {
    createdDate,
    comment: "it broke",
    email: "tester@example.com",
    deviceModel: "iPhone14,2",
    deviceFamily: "IPHONE",
    osVersion: "18.2",
    appPlatform: "IOS",
    devicePlatform: "IOS",
    locale: "en-US",
    timeZone: "UTC",
    architecture: "arm64e",
    connectionType: "WIFI",
    batteryPercentage: 42,
    appUptimeInMilliseconds: 1000,
    buildBundleId: "com.example.app",
    ...overrides,
  },
  relationships: { build: { data: { id: "build-42" } } },
});

const page = (data: readonly unknown[], next?: string) => ({
  data,
  included: [{ type: "builds", id: "build-42", attributes: { version: "42" } }],
  ...(next === undefined ? {} : { links: { next } }),
});

/** Record every requested URL and reply with the queued body per collection. */
const scriptedFetch = (
  bodies: Readonly<Record<string, unknown>>,
  status = 200,
): { readonly urls: string[]; readonly fetchFn: FetchFn } => {
  const urls: string[] = [];
  const fetchFn: FetchFn = async (url) => {
    urls.push(url);
    const key = Object.keys(bodies).find((candidate) => url.includes(candidate)) ?? "";
    return Response.json(bodies[key] ?? { data: [] }, { status });
  };
  return { urls, fetchFn };
};

const input = {
  kinds: ["screenshot", "crash"] as const,
  buildId: undefined,
  deviceModel: undefined,
  osVersion: undefined,
  platform: undefined,
  testerId: undefined,
  limit: 50,
};

describe(listFeedback, () => {
  it.effect("merges both collections newest-first and trims to the limit", () =>
    Effect.gen(function* () {
      const { fetchFn } = scriptedFetch({
        betaFeedbackScreenshotSubmissions: page([submission("s1", "2026-01-02T00:00:00.000Z")]),
        betaFeedbackCrashSubmissions: page([
          submission("c1", "2026-01-03T00:00:00.000Z"),
          submission("c2", "2026-01-01T00:00:00.000Z"),
        ]),
      });
      const items = yield* listFeedback(ctx, "app-1", { ...input, limit: 2, fetchFn });
      expect(items.map((item) => [item.id, item.kind])).toStrictEqual([
        ["c1", "crash"],
        ["s1", "screenshot"],
      ]);
    }),
  );

  it.effect("orders by parsed instant, not by raw string", () =>
    Effect.gen(function* () {
      const { fetchFn } = scriptedFetch({
        betaFeedbackScreenshotSubmissions: page([submission("s1", "2026-11-01T01:15:00-08:00")]),
        betaFeedbackCrashSubmissions: page([submission("c1", "2026-11-01T01:30:00-07:00")]),
      });
      // s1 is 55 minutes LATER than c1 despite sorting earlier as a string.
      const items = yield* listFeedback(ctx, "app-1", { ...input, fetchFn });
      expect(items.map((item) => item.id)).toStrictEqual(["s1", "c1"]);
    }),
  );

  it.effect("stops after the first page once the limit is satisfied", () =>
    Effect.gen(function* () {
      const { urls, fetchFn } = scriptedFetch({
        betaFeedbackCrashSubmissions: page(
          [submission("c1", "2026-01-03T00:00:00.000Z")],
          "https://api.appstoreconnect.apple.com/v1/apps/app-1/betaFeedbackCrashSubmissions?cursor=NEXT",
        ),
      });
      yield* listFeedback(ctx, "app-1", { ...input, kinds: ["crash"], limit: 1, fetchFn });
      expect(urls).toHaveLength(1);
      expect(urls[0]).not.toContain("cursor=NEXT");
    }),
  );

  it.effect("follows links.next while the limit is unmet", () =>
    Effect.gen(function* () {
      const urls: string[] = [];
      const fetchFn: FetchFn = async (url) => {
        urls.push(url);
        const body = url.includes("cursor=NEXT")
          ? page([submission("c2", "2026-01-01T00:00:00.000Z")])
          : page(
              [submission("c1", "2026-01-03T00:00:00.000Z")],
              "https://api.appstoreconnect.apple.com/v1/apps/app-1/betaFeedbackCrashSubmissions?cursor=NEXT",
            );
        return Response.json(body, { status: 200 });
      };
      const items = yield* listFeedback(ctx, "app-1", {
        ...input,
        kinds: ["crash"],
        limit: 2,
        fetchFn,
      });
      expect(urls).toHaveLength(2);
      expect(items.map((item) => item.id)).toStrictEqual(["c1", "c2"]);
    }),
  );

  it.effect("requests only the collection its kind was asked for", () =>
    Effect.gen(function* () {
      const { urls, fetchFn } = scriptedFetch({ betaFeedbackCrashSubmissions: page([]) });
      yield* listFeedback(ctx, "app-1", { ...input, kinds: ["crash"], fetchFn });
      expect(urls).toHaveLength(1);
      expect(urls[0]).toContain("/betaFeedbackCrashSubmissions?");
    }),
  );

  it.effect("sends the server-side filters and clamps the page size to 200", () =>
    Effect.gen(function* () {
      const { urls, fetchFn } = scriptedFetch({ betaFeedbackCrashSubmissions: page([]) });
      yield* listFeedback(ctx, "app-1", {
        ...input,
        kinds: ["crash"],
        buildId: "build-9",
        osVersion: "18.2",
        platform: "IOS",
        testerId: "tester-7",
        limit: 500,
        fetchFn,
      });
      const query = new URL(urls[0] ?? "").searchParams;
      expect(query.get("limit")).toBe("200");
      expect(query.get("sort")).toBe("-createdDate");
      expect(query.get("include")).toBe("build");
      expect(query.get("filter[build]")).toBe("build-9");
      expect(query.get("filter[osVersion]")).toBe("18.2");
      expect(query.get("filter[appPlatform]")).toBe("IOS");
      expect(query.get("filter[tester]")).toBe("tester-7");
    }),
  );

  it.effect("matches --device-model client-side instead of sending a comma filter", () =>
    Effect.gen(function* () {
      const { urls, fetchFn } = scriptedFetch({
        betaFeedbackCrashSubmissions: page([
          submission("c1", "2026-01-03T00:00:00.000Z"),
          submission("c2", "2026-01-02T00:00:00.000Z", { deviceModel: "iPad13,1" }),
        ]),
      });
      const items = yield* listFeedback(ctx, "app-1", {
        ...input,
        kinds: ["crash"],
        deviceModel: "iPhone14,2",
        fetchFn,
      });
      expect(new URL(urls[0] ?? "").searchParams.get("filter[deviceModel]")).toBeNull();
      expect(items.map((item) => item.id)).toStrictEqual(["c1"]);
    }),
  );

  it.effect("resolves each row's build from the response's included resources", () =>
    Effect.gen(function* () {
      const { fetchFn } = scriptedFetch({
        betaFeedbackScreenshotSubmissions: page([
          {
            ...submission("s1", "2026-01-02T00:00:00.000Z"),
            attributes: {
              ...submission("s1", "2026-01-02T00:00:00.000Z").attributes,
              screenshots: [
                {
                  url: "https://example.com/a.png",
                  width: 1170,
                  height: 2532,
                  expirationDate: "2026-01-03T00:00:00.000Z",
                },
              ],
            },
          },
        ]),
        betaFeedbackCrashSubmissions: page([submission("c1", "2026-01-01T00:00:00.000Z")]),
      });
      const [shot, crash] = yield* listFeedback(ctx, "app-1", { ...input, fetchFn });
      expect(shot?.build).toStrictEqual({ id: "build-42", version: "42" });
      expect(shot?.screenshots).toStrictEqual([
        {
          url: "https://example.com/a.png",
          width: 1170,
          height: 2532,
          expiresAt: "2026-01-03T00:00:00.000Z",
        },
      ]);
      expect(crash?.screenshots).toStrictEqual([]);
    }),
  );

  it.effect("fails with the Apple error when a page is not 200", () =>
    Effect.gen(function* () {
      const { fetchFn } = scriptedFetch(
        { betaFeedbackCrashSubmissions: { errors: [{ detail: "nope" }] } },
        403,
      );
      const exit = yield* listFeedback(ctx, "app-1", {
        ...input,
        kinds: ["crash"],
        fetchFn,
      }).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );
});

describe(resolveFeedbackBuildId, () => {
  it.effect("returns undefined when neither selector flag was given", () =>
    Effect.gen(function* () {
      const { urls, fetchFn } = scriptedFetch({});
      const resolved = yield* resolveFeedbackBuildId(
        ctx,
        "app-1",
        { buildId: undefined, buildVersion: undefined, platform: undefined },
        fetchFn,
      );
      expect(resolved).toBeUndefined();
      expect(urls).toHaveLength(0);
    }),
  );

  it.effect("scopes an explicit build id to the app and the platform", () =>
    Effect.gen(function* () {
      const { urls, fetchFn } = scriptedFetch({ builds: { data: [{ id: "build-9" }] } });
      const resolved = yield* resolveFeedbackBuildId(
        ctx,
        "app-1",
        { buildId: "build-9", buildVersion: undefined, platform: "TV_OS" },
        fetchFn,
      );
      expect(resolved).toBe("build-9");
      const query = new URL(urls[0] ?? "").searchParams;
      expect(query.get("filter[app]")).toBe("app-1");
      expect(query.get("filter[id]")).toBe("build-9");
      expect(query.get("filter[preReleaseVersion.platform]")).toBe("TV_OS");
    }),
  );

  it.effect("resolves a build number to its id", () =>
    Effect.gen(function* () {
      const { urls, fetchFn } = scriptedFetch({ builds: { data: [{ id: "build-42" }] } });
      const resolved = yield* resolveFeedbackBuildId(
        ctx,
        "app-1",
        { buildId: undefined, buildVersion: "42", platform: undefined },
        fetchFn,
      );
      expect(resolved).toBe("build-42");
      expect(new URL(urls[0] ?? "").searchParams.get("filter[version]")).toBe("42");
    }),
  );

  it.effect("fails when the build is not one of this app's", () =>
    Effect.gen(function* () {
      const { fetchFn } = scriptedFetch({ builds: { data: [] } });
      const exit = yield* resolveFeedbackBuildId(
        ctx,
        "app-1",
        { buildId: "foreign", buildVersion: undefined, platform: undefined },
        fetchFn,
      ).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );
});
