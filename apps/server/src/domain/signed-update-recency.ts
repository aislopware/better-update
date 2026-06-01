import { safeJsonParse } from "@better-update/safe-json";
import { isRecord } from "@better-update/type-guards";

// Pure recency rules for the commitTime/created_at invariant and the publish-time
// clock-skew guard that backs it.
//
// The device selects the newest update by the SERVED body's commitTime: a normal
// manifest's `createdAt`, or a rollBackToEmbedded directive's
// `parameters.commitTime`. It only switches when that value is STRICTLY greater
// than the launched update's (iOS `.orderedAscending` / Android `Date.after`,
// both exclusive). Signed manifests and ALL directive bodies are served VERBATIM,
// so their commitTime is whatever the publishing machine stamped — not the server
// clock. The server, however, orders candidates by the DB `created_at` (server
// clock). Under cross-machine clock skew the two clocks disagree: the server
// would consider a freshly-inserted precomputed row "newest" while every device
// on the current update computes its commitTime as OLDER and refuses it — the
// update silently never applies (UPDATE_REJECTED_BY_SELECTION_POLICY).
//
// INVARIANT (enforced by `publishCreatedAt` at insert time): DB `created_at` ==
// the served commitTime for every precomputed row. Unsigned normal updates render
// their `createdAt` FROM the DB value, so they agree by construction. With the
// invariant, the server's `ORDER BY created_at DESC` resolution picks exactly the
// row the device considers newest — server-newest == device-newest for ALL rows,
// regardless of which clock stamped them. `clockSkewConflict` then only has to
// reject a precomputed publish whose commitTime is not strictly newer than the
// row the server currently serves — a clear publish-time error instead of a
// silently never-served update.
//
// `domain/` stays pure: total, sync, no I/O.

const stringField = (value: unknown, key: string): string | null => {
  if (!isRecord(value)) {
    return null;
  }
  const field = value[key];
  return typeof field === "string" ? field : null;
};

// The `createdAt` string inside a (signed) manifest body, or null when the body
// is not a JSON object or carries no string `createdAt`.
export const manifestCreatedAt = (manifestBody: string): string | null =>
  stringField(safeJsonParse(manifestBody), "createdAt");

// The `parameters.commitTime` string inside a rollBackToEmbedded directive body,
// or null when the body is not a JSON object or carries no string commitTime.
export const directiveCommitTime = (directiveBody: string): string | null => {
  const parsed = safeJsonParse(directiveBody);
  return isRecord(parsed) ? stringField(parsed["parameters"], "commitTime") : null;
};

// The commitTime the DEVICE orders this row by once served: a manifest body's
// `createdAt`, a directive body's `parameters.commitTime`, else null (an unsigned
// normal update — the server renders its createdAt from the DB created_at, so no
// stored commitTime constrains it).
export const servedCommitTime = (row: {
  readonly manifestBody: string | null;
  readonly directiveBody: string | null;
}): string | null => {
  if (row.manifestBody !== null) {
    return manifestCreatedAt(row.manifestBody);
  }
  if (row.directiveBody !== null) {
    return directiveCommitTime(row.directiveBody);
  }
  return null;
};

// The DB `created_at` to stamp so server ordering matches the device's commitTime
// ordering exactly (the INVARIANT above): the served commitTime for a precomputed
// row, else `fallback` (the server clock, for unsigned normal updates that render
// their createdAt from it).
export const publishCreatedAt = (params: {
  readonly manifestBody: string | null;
  readonly directiveBody: string | null;
  readonly fallback: string;
}): string => servedCommitTime(params) ?? params.fallback;

// The createdAt the DEVICE compares for an existing row: its served commitTime,
// falling back to the DB created_at when a stored precomputed body somehow lacks
// a string commitTime. Under the `publishCreatedAt` invariant this equals the DB
// created_at, but deriving it from the body keeps the guard correct for any row.
export const servedCreatedAt = (row: {
  readonly manifestBody: string | null;
  readonly directiveBody: string | null;
  readonly createdAt: string;
}): string => servedCommitTime(row) ?? row.createdAt;
