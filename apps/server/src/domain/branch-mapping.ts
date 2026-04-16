import { safeJsonParse } from "@better-update/safe-json";

import { isRecord } from "../lib/type-guards";
import { hashToFraction } from "./hash";

// -- Types ------------------------------------------------------------------

interface BranchMappingEntry {
  branchId: string;
  branchMappingLogic: string;
}

interface BranchMapping {
  data: BranchMappingEntry[];
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

export const buildBranchMapping = (params: {
  newBranchId: string;
  oldBranchId: string;
  percentage: number;
  salt: string;
}): string => {
  const mapping: BranchMapping = {
    data: [
      {
        branchId: params.newBranchId,
        branchMappingLogic: `hash_lt(mappingId, ${(params.percentage / 100).toFixed(2)})`,
      },
      { branchId: params.oldBranchId, branchMappingLogic: "true" },
    ],
    salt: params.salt,
  };
  return JSON.stringify(mapping);
};

export const updateBranchMappingPercentage = (existing: string, percentage: number): string => {
  const mapping = parseBranchMapping(existing);
  const [first, ...rest] = mapping.data;
  if (!first) {
    return JSON.stringify(mapping);
  }
  const updated: BranchMapping = {
    ...mapping,
    data: [
      { ...first, branchMappingLogic: `hash_lt(mappingId, ${(percentage / 100).toFixed(2)})` },
      ...rest,
    ],
  };
  return JSON.stringify(updated);
};

export const extractNewBranchId = (branchMappingJson: string): string => {
  const mapping = parseBranchMapping(branchMappingJson);
  return mapping.data[0]?.branchId ?? "";
};

// -- Evaluator (manifest resolution) ---------------------------------------

const parseThreshold = (logic: string): number | null => {
  const match = /^hash_lt\(mappingId,\s*([\d.]+)\)$/.exec(logic);
  return match?.[1] ? Number.parseFloat(match[1]) : null;
};

export const extractReachableBranchIds = (branchMappingJson: string): readonly string[] => {
  const mapping = parseBranchMapping(branchMappingJson);
  return mapping.data.reduce<readonly string[]>((branchIds, entry) => {
    const threshold =
      entry.branchMappingLogic === "true" ? 1 : parseThreshold(entry.branchMappingLogic);

    return threshold !== null && threshold > 0 && !branchIds.includes(entry.branchId)
      ? [...branchIds, entry.branchId]
      : branchIds;
  }, []);
};

const evaluateEntry = async (
  entry: BranchMappingEntry,
  salt: string,
  easClientId: string,
): Promise<string | null> => {
  if (entry.branchMappingLogic === "true") {
    return entry.branchId;
  }
  const threshold = parseThreshold(entry.branchMappingLogic);
  if (threshold === null) {
    return null;
  }
  const value = await hashToFraction(salt, easClientId);
  return value < threshold ? entry.branchId : null;
};

export const evaluateBranchMapping = async (
  branchMappingJson: string,
  easClientId: string | undefined,
): Promise<string> => {
  const mapping = parseBranchMapping(branchMappingJson);
  const fallback = mapping.data.at(-1)?.branchId ?? "";

  // No client ID -> always fallback (last "true" entry)
  if (!easClientId) {
    return fallback;
  }

  const results = await Promise.all(
    mapping.data.map(async (entry) => evaluateEntry(entry, mapping.salt, easClientId)),
  );

  return results.find((result) => result !== null) ?? fallback;
};
