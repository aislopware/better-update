/**
 * App Store Connect TestFlight operations layered on the ASC API-key client
 * ({@link ./apple-asc-client}). Used by the iOS submit flow to configure a build
 * *after* `altool` uploads it: set the "What to Test" text and assign the build
 * to internal beta groups — matching `eas submit`'s post-upload behaviour.
 */
import { isRecord } from "@better-update/type-guards";
import { Effect } from "effect";

import { extractList, fetchRaw, nextPagePath, withJwt } from "./apple-asc-client";

import type { AscCredentials } from "./apple-asc-client";

export interface AscApp {
  readonly id: string;
  readonly bundleId: string | null;
  readonly name: string | null;
}

/** Apple's build processing lifecycle. `valid` = ready for TestFlight config. */
export type AscBuildProcessingState = "processing" | "valid" | "failed";

export interface AscBuild {
  readonly id: string;
  /** CFBundleVersion (the build number), e.g. `"42"`. Absent until processed. */
  readonly version: string | null;
  readonly uploadedDate: string | null;
  readonly processingState: string | null;
}

export interface AscBetaGroup {
  readonly id: string;
  readonly name: string;
  readonly isInternal: boolean;
}

export interface AscBetaBuildLocalization {
  readonly id: string;
  readonly locale: string;
  readonly whatsNew: string | null;
}

const toAscApp = (value: unknown): AscApp | null => {
  if (!isRecord(value)) {
    return null;
  }
  const { id, attributes } = value;
  if (typeof id !== "string") {
    return null;
  }
  const attrs = isRecord(attributes) ? attributes : {};
  return {
    id,
    bundleId: typeof attrs["bundleId"] === "string" ? attrs["bundleId"] : null,
    name: typeof attrs["name"] === "string" ? attrs["name"] : null,
  };
};

const toAscBuild = (value: unknown): AscBuild | null => {
  if (!isRecord(value)) {
    return null;
  }
  const { id, attributes } = value;
  if (typeof id !== "string") {
    return null;
  }
  const attrs = isRecord(attributes) ? attributes : {};
  return {
    id,
    version: typeof attrs["version"] === "string" ? attrs["version"] : null,
    uploadedDate: typeof attrs["uploadedDate"] === "string" ? attrs["uploadedDate"] : null,
    processingState: typeof attrs["processingState"] === "string" ? attrs["processingState"] : null,
  };
};

const toAscBetaGroup = (value: unknown): AscBetaGroup | null => {
  if (!isRecord(value)) {
    return null;
  }
  const { id, attributes } = value;
  if (typeof id !== "string" || !isRecord(attributes)) {
    return null;
  }
  const { name, isInternalGroup } = attributes;
  if (typeof name !== "string") {
    return null;
  }
  return { id, name, isInternal: isInternalGroup === true };
};

const toAscBetaBuildLocalization = (value: unknown): AscBetaBuildLocalization | null => {
  if (!isRecord(value)) {
    return null;
  }
  const { id, attributes } = value;
  if (typeof id !== "string" || !isRecord(attributes)) {
    return null;
  }
  const { locale, whatsNew } = attributes;
  if (typeof locale !== "string") {
    return null;
  }
  return { id, locale, whatsNew: typeof whatsNew === "string" ? whatsNew : null };
};

/** Classify a raw `processingState`. Unknown/absent states stay `processing`
 * so the poller keeps waiting rather than failing early. */
export const classifyProcessingState = (state: string | null): AscBuildProcessingState => {
  if (state === "VALID") {
    return "valid";
  }
  if (state === "FAILED" || state === "INVALID") {
    return "failed";
  }
  return "processing";
};

/**
 * Identify the build produced by *our* upload. `listRecentBuilds` returns builds
 * newest-first; the freshly-uploaded build is the newest one whose id differs
 * from the baseline captured before upload. Comparing ids (not timestamps) avoids
 * both clock-skew misses and accidentally matching a pre-existing build.
 */
export const pickNewBuild = (
  builds: readonly AscBuild[],
  baselineLatestBuildId: string | null,
): AscBuild | null => {
  const [newest] = builds;
  if (newest === undefined || newest.id === baselineLatestBuildId) {
    return null;
  }
  return newest;
};

export const matchBetaGroupsByName = (
  groups: readonly AscBetaGroup[],
  names: readonly string[],
): { readonly matched: readonly AscBetaGroup[]; readonly missing: readonly string[] } => {
  const byName = new Map(groups.map((group) => [group.name, group] as const));
  const matched: AscBetaGroup[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const group = byName.get(name);
    if (group === undefined) {
      missing.push(name);
    } else {
      matched.push(group);
    }
  }
  return { matched, missing };
};

/** Resolve the ASC app record for a bundle identifier, or null when none exists. */
export const getAppByBundleId = (credentials: AscCredentials, bundleId: string) =>
  withJwt(credentials, (jwt) =>
    Effect.gen(function* () {
      const body = yield* fetchRaw(
        jwt,
        `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`,
      );
      const [first] = extractList(body, toAscApp);
      return first === undefined ? null : first;
    }),
  );

/** Builds for an app, newest upload first. */
export const listRecentBuilds = (credentials: AscCredentials, appId: string, limit = 20) =>
  withJwt(credentials, (jwt) =>
    Effect.gen(function* () {
      const body = yield* fetchRaw(
        jwt,
        `/v1/builds?filter[app]=${encodeURIComponent(appId)}&sort=-uploadedDate&limit=${String(limit)}`,
      );
      return extractList(body, toAscBuild);
    }),
  );

export const listBetaGroups = (credentials: AscCredentials, appId: string) =>
  withJwt(credentials, (jwt) =>
    Effect.gen(function* () {
      const groups: AscBetaGroup[] = [];
      let path: string | null = `/v1/betaGroups?filter[app]=${encodeURIComponent(appId)}&limit=200`;
      while (path !== null) {
        const body = yield* fetchRaw(jwt, path);
        groups.push(...extractList(body, toAscBetaGroup));
        path = nextPagePath(body);
      }
      return groups as readonly AscBetaGroup[];
    }),
  );

export const listBuildBetaLocalizations = (credentials: AscCredentials, buildId: string) =>
  withJwt(credentials, (jwt) =>
    Effect.gen(function* () {
      const body = yield* fetchRaw(
        jwt,
        `/v1/builds/${encodeURIComponent(buildId)}/betaBuildLocalizations?limit=200`,
      );
      return extractList(body, toAscBetaBuildLocalization);
    }),
  );

export const createBetaBuildLocalization = (
  credentials: AscCredentials,
  params: { readonly buildId: string; readonly locale: string; readonly whatsNew: string },
) =>
  withJwt(credentials, (jwt) =>
    Effect.asVoid(
      fetchRaw(jwt, "/v1/betaBuildLocalizations", {
        method: "POST",
        body: JSON.stringify({
          data: {
            type: "betaBuildLocalizations",
            attributes: { locale: params.locale, whatsNew: params.whatsNew },
            relationships: { build: { data: { type: "builds", id: params.buildId } } },
          },
        }),
      }),
    ),
  );

export const updateBetaBuildLocalization = (
  credentials: AscCredentials,
  params: { readonly id: string; readonly whatsNew: string },
) =>
  withJwt(credentials, (jwt) =>
    Effect.asVoid(
      fetchRaw(jwt, `/v1/betaBuildLocalizations/${encodeURIComponent(params.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          data: {
            type: "betaBuildLocalizations",
            id: params.id,
            attributes: { whatsNew: params.whatsNew },
          },
        }),
      }),
    ),
  );

export const addBuildToBetaGroups = (
  credentials: AscCredentials,
  buildId: string,
  groupIds: readonly string[],
) =>
  withJwt(credentials, (jwt) =>
    Effect.asVoid(
      fetchRaw(jwt, `/v1/builds/${encodeURIComponent(buildId)}/relationships/betaGroups`, {
        method: "POST",
        body: JSON.stringify({
          data: groupIds.map((id) => ({ type: "betaGroups", id })),
        }),
      }),
    ),
  );
