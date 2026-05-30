import { safeJsonParse } from "@better-update/safe-json";
import { isRecord } from "@better-update/type-guards";
import { Effect } from "effect";

import {
  evaluateNode,
  isRolloutHashLeaf,
  isStatementNode,
  NEVER_MATCH,
  normalizeLogic,
  referencesRolloutToken,
  statementChildren,
} from "./branch-mapping-node";
import { CryptoService } from "./crypto-service";

import type {
  BranchMappingLogic,
  BranchMappingNode,
  BranchMappingObject,
  BranchMappingStatement,
  EvaluationContext,
} from "./branch-mapping-node";
import type { CryptoError } from "./crypto-service";

// -- Mapping container (parse) ----------------------------------------------

interface BranchMappingEntry {
  branchId: string;
  // Widened from `string` to also accept structured nodes so EAS-shaped JSON
  // parses; legacy string forms still round-trip via normalizeLogic.
  branchMappingLogic: BranchMappingLogic;
}

interface BranchMapping {
  data: BranchMappingEntry[];
  // `salt` is a better-update local extension (EAS is saltless). Kept REQUIRED
  // so already-written rows still parse, and re-emitted by the builder.
  salt: string;
}

const isBranchMapping = (value: unknown): value is BranchMapping =>
  isRecord(value) && Array.isArray(value["data"]) && typeof value["salt"] === "string";

const emptyMapping: BranchMapping = { data: [], salt: "" };

const parseBranchMapping = (json: string): BranchMapping => {
  const raw = safeJsonParse(json);
  return isBranchMapping(raw) ? raw : emptyMapping;
};

// -- Builder functions (management API) ------------------------------------

// 2-decimal operand to match the legacy hash_lt(mappingId, 0.NN) precision.
const rolloutHashLtNode = (percentage: number): BranchMappingObject => ({
  clientKey: "rolloutToken",
  branchMappingOperator: "hash_lt",
  operand: Number((percentage / 100).toFixed(2)),
});

export const buildBranchMapping = (params: {
  newBranchId: string;
  oldBranchId: string;
  percentage: number;
  salt: string;
  runtimeVersion?: string | undefined;
}): string => {
  const hashNode = rolloutHashLtNode(params.percentage);
  const firstLogic: BranchMappingNode =
    params.runtimeVersion === undefined
      ? hashNode
      : [
          "and",
          {
            clientKey: "runtimeVersion",
            branchMappingOperator: "==",
            operand: params.runtimeVersion,
          },
          hashNode,
        ];
  const mapping: BranchMapping = {
    data: [
      { branchId: params.newBranchId, branchMappingLogic: firstLogic },
      { branchId: params.oldBranchId, branchMappingLogic: "true" },
    ],
    salt: params.salt,
  };
  return JSON.stringify(mapping);
};

// Rewrite ONLY the rolloutToken hash node's operand inside a first-entry logic —
// bare leaf or nested under an `and` (preserving a runtimeVersion constraint).
// Returns undefined when no rolloutToken hash node is present.
const withUpdatedHashOperand = (
  logic: BranchMappingLogic,
  percentage: number,
): BranchMappingNode | undefined => {
  const normalized = normalizeLogic(logic);
  if (normalized === NEVER_MATCH) {
    return undefined;
  }
  const operand = Number((percentage / 100).toFixed(2));

  const updateNode = (node: BranchMappingNode): BranchMappingNode | undefined => {
    if (node === "true") {
      return undefined;
    }
    if (isStatementNode(node)) {
      const [head] = node;
      if (head === "not") {
        return undefined;
      }
      const rewrites = statementChildren(node).map((child) => ({
        child,
        updated: updateNode(child),
      }));
      if (!rewrites.some((entry) => entry.updated !== undefined)) {
        return undefined;
      }
      const children = rewrites.map((entry) => entry.updated ?? entry.child);
      return [head, ...children] satisfies BranchMappingStatement;
    }
    return isRolloutHashLeaf(node) ? { ...node, operand } : undefined;
  };

  return updateNode(normalized);
};

export const updateBranchMappingPercentage = (existing: string, percentage: number): string => {
  const mapping = parseBranchMapping(existing);
  const [first, ...rest] = mapping.data;
  if (!first) {
    return JSON.stringify(mapping);
  }
  const updatedLogic = withUpdatedHashOperand(first.branchMappingLogic, percentage);
  // No rolloutToken hash node found (e.g. a bare RTV `==` mapping) — fall back to
  // a fresh canonical hash_lt leaf to preserve the prior overwrite behavior.
  const nextLogic: BranchMappingNode = updatedLogic ?? rolloutHashLtNode(percentage);
  const updated: BranchMapping = {
    ...mapping,
    data: [{ ...first, branchMappingLogic: nextLogic }, ...rest],
  };
  return JSON.stringify(updated);
};

export const extractNewBranchId = (branchMappingJson: string): string | null => {
  const mapping = parseBranchMapping(branchMappingJson);
  const branchId = mapping.data[0]?.branchId;
  return branchId === undefined ? null : branchId;
};

// -- Reachable branch ids (cache invalidation + reaper liveness) ------------

// SUPERSET tree-walk: an entry's branchId is reachable iff its logic normalizes
// to a valid node (NOT the never-match sentinel). Every node form ("true", any
// leaf — INCLUDING hash_lt 0.00, and/or/not statements) counts as reachable;
// over-counting is safe (under-counting would let the reaper delete a still-
// routable branch's updates). Un-normalizable logic (unsupported legacy string
// / invalid node) is excluded — EXCEPT the last entry, which the evaluator
// always routes to as the unconditional anti-brick fallback (see
// evaluateBranchMapping below), so it is ALWAYS reachable regardless of whether
// its logic normalizes. This keeps the two functions in lock-step: every branch
// the evaluator can return is in this set.
export const extractReachableBranchIds = (branchMappingJson: string): readonly string[] => {
  const mapping = parseBranchMapping(branchMappingJson);
  const fallbackBranchId = mapping.data.at(-1)?.branchId;
  const normalizedReachable = mapping.data.reduce<readonly string[]>((branchIds, entry) => {
    const node = normalizeLogic(entry.branchMappingLogic);
    return node !== NEVER_MATCH && !branchIds.includes(entry.branchId)
      ? [...branchIds, entry.branchId]
      : branchIds;
  }, []);
  return fallbackBranchId !== undefined && !normalizedReachable.includes(fallbackBranchId)
    ? [...normalizedReachable, fallbackBranchId]
    : normalizedReachable;
};

// -- Evaluator (manifest resolution) ---------------------------------------

export const evaluateBranchMapping = (
  branchMappingJson: string,
  ctx: {
    easClientId?: string | undefined;
    runtimeVersion?: string | undefined;
    extraParams?: Record<string, string> | undefined;
  },
): Effect.Effect<string | null, CryptoError, CryptoService> =>
  Effect.gen(function* () {
    const mapping = parseBranchMapping(branchMappingJson);
    // INTENTIONAL EAS DIVERGENCE: EAS branchMappingLogic is first-match-wins and
    // yields NO branch (no-update) when nothing matches and there is no explicit
    // 'true' entry. better-update instead always routes to the LAST entry's
    // branchId as an anti-brick fallback (matches the legacy implementation;
    // every first-party builder writes a 'true' last entry, so it is benign in
    // practice). This fallback is UNCONDITIONAL — it applies even if the last
    // entry's logic is un-normalizable (NEVER_MATCH) — so extractReachableBranchIds
    // ALWAYS includes the last branchId to stay a strict superset of routes.
    const last = mapping.data.at(-1)?.branchId;
    const fallback = last === undefined ? null : last;

    // Normalize once, dropping never-match entries so the rest are typed nodes.
    const entries = mapping.data.flatMap((entry) => {
      const node = normalizeLogic(entry.branchMappingLogic);
      return node === NEVER_MATCH ? [] : [{ branchId: entry.branchId, node }];
    });

    // Compute the rolloutToken fraction ONCE — only with an easClientId AND at
    // least one node referencing rolloutToken.
    const { easClientId } = ctx;
    const needsRolloutToken =
      easClientId !== undefined && entries.some((entry) => referencesRolloutToken(entry.node));

    const rolloutToken =
      easClientId !== undefined && needsRolloutToken
        ? yield* (yield* CryptoService).sha256Fraction(mapping.salt, easClientId)
        : undefined;

    const evalCtx: EvaluationContext = {
      rolloutToken,
      runtimeVersion: ctx.runtimeVersion,
      extraParams: ctx.extraParams ?? {},
    };

    // First entry (top-to-bottom) whose node evaluates true.
    const matched = entries.find((entry) => evaluateNode(entry.node, evalCtx));

    return matched?.branchId ?? fallback;
  });
