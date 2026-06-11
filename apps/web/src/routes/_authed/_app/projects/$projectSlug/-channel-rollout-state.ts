import { safeJsonParse } from "@better-update/safe-json";

interface RolloutEntry {
  branchId: string;
  branchMappingLogic: unknown;
}

interface BranchMappingShape {
  data: RolloutEntry[];
}

const isBranchMapping = (value: unknown): value is BranchMappingShape =>
  typeof value === "object" && value !== null && "data" in value && Array.isArray(value.data);

// The server stores rollout logic either as the legacy string form
// `hash_lt(mappingId, 0.NN)` or as the structured node
// `{ clientKey: "rolloutToken", branchMappingOperator: "hash_lt", operand }`
// (see apps/server/src/domain/branch-mapping-node.ts).
const rolloutOperand = (logic: unknown): number | null => {
  if (typeof logic === "string") {
    const match = /^hash_lt\(mappingId,\s*(?<operand>[\d.]+)\)$/u.exec(logic);
    return match?.[1] ? Number.parseFloat(match[1]) : null;
  }
  if (typeof logic === "object" && logic !== null) {
    const node = logic as {
      clientKey?: unknown;
      branchMappingOperator?: unknown;
      operand?: unknown;
    };
    if (
      node.clientKey === "rolloutToken" &&
      node.branchMappingOperator === "hash_lt" &&
      typeof node.operand === "number"
    ) {
      return node.operand;
    }
  }
  return null;
};

export const parseRolloutState = (
  json: string,
): { targetBranchId: string; percentage: number } | null => {
  const parsed = safeJsonParse(json);
  if (!isBranchMapping(parsed) || parsed.data.length === 0) {
    return null;
  }
  const [first] = parsed.data;
  if (!first) {
    return null;
  }
  const operand = rolloutOperand(first.branchMappingLogic);
  return operand !== null && Number.isFinite(operand)
    ? {
        targetBranchId: first.branchId,
        percentage: Math.round(operand * 100),
      }
    : null;
};
