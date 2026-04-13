import { Effect } from "effect";

interface RolloutEntry {
  branchId: string;
  branchMappingLogic: string;
}

interface BranchMappingShape {
  data: RolloutEntry[];
}

const isBranchMapping = (value: unknown): value is BranchMappingShape =>
  typeof value === "object" && value !== null && "data" in value && Array.isArray(value.data);

const safeJsonParse = (text: string): unknown =>
  Effect.runSync(
    Effect.orElseSucceed(
      Effect.try(() => JSON.parse(text) as unknown),
      () => null,
    ),
  );

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
  const match = /hash_lt\(mappingId,\s*([\d.]+)\)/.exec(first.branchMappingLogic);
  return match?.[1]
    ? {
        targetBranchId: first.branchId,
        percentage: Math.round(Number.parseFloat(match[1]) * 100),
      }
    : null;
};
