import { isRecord } from "@better-update/type-guards";

// -- BranchMappingNode model (EAS grammar) ----------------------------------
//
// Mirrors expo/eas-cli packages/eas-cli/src/channel/branch-mapping.ts. A node is
// the constant `"true"`, a leaf `{clientKey, operator, operand}`, or a boolean
// statement (`["and"|"or", ...nodes]` / `["not", node]`). `domain/` is a pure
// leaf: node evaluation is a sync recursive interpreter against an
// EvaluationContext whose rolloutToken (sha256 fraction) is computed ONCE at the
// mapping boundary by the caller, so the leaf walker needs no CryptoService.

const BRANCH_MAPPING_OPERATORS = [
  "==",
  "!=",
  "<",
  ">",
  "<=",
  ">=",
  "in",
  "regex",
  "hash_lt",
  "hash_lte",
  "hash_gt",
  "hash_gte",
] as const;

type BranchMappingOperator = (typeof BRANCH_MAPPING_OPERATORS)[number];

const HASH_OPERATORS = ["hash_lt", "hash_lte", "hash_gt", "hash_gte"] as const;

type HashOperator = (typeof HASH_OPERATORS)[number];

export const isHashOperator = (op: BranchMappingOperator): op is HashOperator =>
  (HASH_OPERATORS as readonly string[]).includes(op);

type BranchMappingAlwaysTrue = "true";

export interface BranchMappingObject {
  readonly clientKey: string;
  readonly branchMappingOperator: BranchMappingOperator;
  readonly operand: number | string | readonly string[];
}

export type BranchMappingStatement =
  | readonly ["and" | "or", ...BranchMappingNode[]]
  | readonly ["not", BranchMappingNode];

export type BranchMappingNode =
  | BranchMappingAlwaysTrue
  | BranchMappingObject
  | BranchMappingStatement;

// The stored/parsed branchMappingLogic: a legacy string encoding ("true",
// `hash_lt(mappingId, ...)`, or an unsupported form) OR a structured node. The
// AlwaysTrue node ("true") is omitted from the union because it is already a
// `string` — normalizeLogic recognizes the "true" string and yields the node.
export type BranchMappingLogic = string | BranchMappingObject | BranchMappingStatement;

export const isStatementNode = (node: BranchMappingNode): node is BranchMappingStatement =>
  Array.isArray(node);

export const isRolloutHashLeaf = (node: BranchMappingObject): boolean =>
  node.clientKey === "rolloutToken" && isHashOperator(node.branchMappingOperator);

// A sentinel node that never matches and is excluded from the reachable set —
// the structured equivalent of the legacy parseThreshold returning null for an
// unrecognized string (e.g. `unsupported(...)`).
export const NEVER_MATCH = Symbol("branch-mapping-never-match");
export type NeverMatch = typeof NEVER_MATCH;

// -- Node validation + normalization ----------------------------------------

const isOperator = (value: unknown): value is BranchMappingOperator =>
  typeof value === "string" && (BRANCH_MAPPING_OPERATORS as readonly string[]).includes(value);

const isOperand = (value: unknown): value is number | string | readonly string[] =>
  typeof value === "number" ||
  typeof value === "string" ||
  (Array.isArray(value) && value.every((item) => typeof item === "string"));

const isBranchMappingObject = (value: unknown): value is BranchMappingObject =>
  isRecord(value) &&
  typeof value["clientKey"] === "string" &&
  isOperator(value["branchMappingOperator"]) &&
  isOperand(value["operand"]);

const isBranchMappingNode = (value: unknown): value is BranchMappingNode => {
  if (value === "true") {
    return true;
  }
  if (Array.isArray(value)) {
    const members: unknown[] = value;
    const [head, ...rest] = members;
    if (head === "not") {
      return rest.length === 1 && isBranchMappingNode(rest[0]);
    }
    if (head === "and" || head === "or") {
      return rest.length > 0 && rest.every(isBranchMappingNode);
    }
    return false;
  }
  return isBranchMappingObject(value);
};

// Maps a legacy string OR a structured node to a BranchMappingNode, or the
// never-match sentinel. Backward-compat: "true" -> AlwaysTrue;
// `hash_lt(mappingId, 0.NN)` -> rolloutToken hash_lt leaf; anything else -> sentinel.
const legacyHashLtRe = /^hash_lt\(mappingId,\s*(?<operand>[\d.]+)\)$/u;

export const normalizeLogic = (logic: BranchMappingLogic): BranchMappingNode | NeverMatch => {
  if (typeof logic === "string") {
    if (logic === "true") {
      return "true";
    }
    const match = legacyHashLtRe.exec(logic);
    if (match?.[1]) {
      const operand = Number.parseFloat(match[1]);
      return Number.isFinite(operand)
        ? { clientKey: "rolloutToken", branchMappingOperator: "hash_lt", operand }
        : NEVER_MATCH;
    }
    return NEVER_MATCH;
  }
  return isBranchMappingNode(logic) ? logic : NEVER_MATCH;
};

// -- Pure node evaluation ---------------------------------------------------

export interface EvaluationContext {
  readonly rolloutToken: number | undefined;
  readonly runtimeVersion: string | undefined;
  readonly extraParams: ReadonlyMap<string, string> | Record<string, string>;
}

// ReDoS mitigation (the regex operator is the only untrusted-pattern surface).
// JS RegExp has no time budget, so length caps alone can't tame catastrophic
// backtracking — at n=22 chars `(a|a|a)*c` already pins the isolate for ~112s,
// far below the 1024-char input cap, because the blowup is EXPONENTIAL. A
// static-shape regex heuristic can't reliably enumerate backtracking-prone
// patterns (it's a context-free property), so we do a structural single-pass
// scan that tracks group nesting and rejects the two catastrophic families:
//
//   1. nested unbounded quantifier — a group whose body is variable-width (has
//      `+`/`*`/`{n,}` or a nested variable-width group) that is itself
//      unbounded-quantified: `(a+)+`, `(.*)+`, `(\d+){2,}`, `((a+))+`, `(a*)*`.
//   2. alternation under an unbounded quantifier — a group containing `|` that
//      is unbounded-quantified: `(a|a)*`, `(a|ab)*`, `(a|a|a)*c`, `(.|.)*x`.
//
// Over-rejection is safe (a rejected pattern degrades to a non-match == false).
const MAX_REGEX_OPERAND_LENGTH = 256;
const MAX_REGEX_INPUT_LENGTH = 1024;

// Does `pattern` have an unbounded quantifier (`+`, `*`, `{n,}`, `{n,m}`)
// starting at `index`? Range repetition `{n,m}` also amplifies backtracking, so
// any `{n,...}` counts.
const isUnboundedQuantAt = (pattern: string, index: number): boolean => {
  const ch = pattern[index];
  return ch === "+" || ch === "*" || /^\{\d+,\d*\}/u.test(pattern.slice(index));
};

// Mark the innermost open group as carrying a "variable-width body" flag.
const markInnermost = (stack: readonly boolean[]): readonly boolean[] =>
  stack.length === 0 ? stack : [...stack.slice(0, -1), true];

interface ScanState {
  readonly escaped: boolean;
  readonly inClass: boolean;
  // One flag per open group: did this group's body so far contain a danger
  // token (`|` / unbounded quantifier / a variable-width nested group)?
  readonly stack: readonly boolean[];
  readonly prone: boolean;
}

const INITIAL_SCAN: ScanState = { escaped: false, inClass: false, stack: [], prone: false };

const scanChar = (state: ScanState, ch: string, index: number, pattern: string): ScanState => {
  if (state.prone) {
    return state;
  }
  if (state.escaped) {
    return { ...state, escaped: false };
  }
  if (ch === "\\") {
    return { ...state, escaped: true };
  }
  if (state.inClass) {
    // Inside a char class `[...]`, `|`/`+`/`*` are literals — don't trip on them.
    return { ...state, inClass: ch !== "]" };
  }
  if (ch === "[") {
    return { ...state, inClass: true };
  }
  if (ch === "(") {
    return { ...state, stack: [...state.stack, false] };
  }
  if (ch === ")") {
    const danger = state.stack.at(-1) ?? false;
    const popped = state.stack.slice(0, -1);
    const followedByUnbounded = isUnboundedQuantAt(pattern, index + 1);
    // A variable-width group that is then unbounded-quantified is the
    // catastrophic shape.
    if (danger && followedByUnbounded) {
      return { ...state, stack: popped, prone: true };
    }
    // Propagate upward: a closed group whose body was variable-width, OR a
    // closed group that is itself unbounded-quantified, makes the PARENT body
    // variable-width so an outer quantifier over it would be catastrophic.
    return danger || followedByUnbounded
      ? { ...state, stack: markInnermost(popped) }
      : { ...state, stack: popped };
  }
  const isDanger = ch === "|" || ch === "+" || ch === "*" || isUnboundedQuantAt(pattern, index);
  return isDanger && state.stack.length > 0
    ? { ...state, stack: markInnermost(state.stack) }
    : state;
};

// Fold over UTF-16 indices (the unit RegExp itself operates on) so the scan
// stays index-aligned with `pattern.slice(...)` lookahead — spreading to code
// points would misalign on surrogate pairs. `charAt` returns "" out of range,
// so the char is always a string (no nullish fallback needed).
const isRedosProne = (pattern: string): boolean =>
  Array.from({ length: pattern.length }, (_unused, index) => index).reduce<ScanState>(
    (state, index) => scanChar(state, pattern.charAt(index), index, pattern),
    INITIAL_SCAN,
  ).prone;

const safeRegexTest = (pattern: string, value: string): boolean => {
  if (pattern.length > MAX_REGEX_OPERAND_LENGTH || value.length > MAX_REGEX_INPUT_LENGTH) {
    return false;
  }
  if (isRedosProne(pattern)) {
    return false;
  }
  // eslint-disable-next-line functional/no-try-statements -- an invalid regex string must degrade to a non-match (false), never throw and become an Effect defect on the manifest path
  try {
    return new RegExp(pattern, "u").test(value);
  } catch {
    return false;
  }
};

const toFiniteNumber = (
  value: number | string | readonly string[] | undefined,
): number | undefined => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

type Comparison = "lt" | "lte" | "gt" | "gte";

const COMPARATORS: Record<Comparison, (left: number, right: number) => boolean> = {
  lt: (left, right) => left < right,
  lte: (left, right) => left <= right,
  gt: (left, right) => left > right,
  gte: (left, right) => left >= right,
};

const compareNumbers = (comparison: Comparison, left: number, right: number): boolean =>
  COMPARATORS[comparison](left, right);

const NUMERIC_OP_TO_COMPARISON: Record<"<" | ">" | "<=" | ">=", Comparison> = {
  "<": "lt",
  ">": "gt",
  "<=": "lte",
  ">=": "gte",
};

const HASH_OP_TO_COMPARISON: Record<HashOperator, Comparison> = {
  hash_lt: "lt",
  hash_lte: "lte",
  hash_gt: "gt",
  hash_gte: "gte",
};

const matchNumericOrdered = (
  op: "<" | ">" | "<=" | ">=",
  actual: number | string | undefined,
  operand: number | string | readonly string[],
): boolean => {
  const left = toFiniteNumber(actual);
  const right = toFiniteNumber(operand);
  return left === undefined || right === undefined
    ? false
    : compareNumbers(NUMERIC_OP_TO_COMPARISON[op], left, right);
};

// Never throws; any type mismatch (wrong operand kind for the op) -> false.
const matchOperator = (
  op: BranchMappingOperator,
  actual: number | string | undefined,
  operand: number | string | readonly string[],
): boolean => {
  if (op === "==") {
    return !Array.isArray(operand) && actual === operand;
  }
  if (op === "!=") {
    return !Array.isArray(operand) && actual !== operand;
  }
  if (op === "in") {
    return Array.isArray(operand) && typeof actual === "string" && operand.includes(actual);
  }
  if (op === "regex") {
    return typeof operand === "string" && typeof actual === "string"
      ? safeRegexTest(operand, actual)
      : false;
  }
  if (op === "<" || op === ">" || op === "<=" || op === ">=") {
    return matchNumericOrdered(op, actual, operand);
  }
  // hash_lt / hash_lte / hash_gt / hash_gte — only valid on the numeric token.
  return typeof actual === "number" && typeof operand === "number"
    ? compareNumbers(HASH_OP_TO_COMPARISON[op], actual, operand)
    : false;
};

const isReadonlyStringMap = (
  value: ReadonlyMap<string, string> | Record<string, string>,
): value is ReadonlyMap<string, string> => value instanceof Map;

const extraParamValue = (
  extraParams: ReadonlyMap<string, string> | Record<string, string>,
  key: string,
): string | undefined => {
  if (isReadonlyStringMap(extraParams)) {
    return extraParams.get(key);
  }
  return Object.hasOwn(extraParams, key) ? extraParams[key] : undefined;
};

const evaluateLeaf = (node: BranchMappingObject, ctx: EvaluationContext): boolean => {
  const { clientKey, branchMappingOperator: op, operand } = node;

  if (clientKey === "rolloutToken") {
    // hash_* only; an undefined token (no easClientId) never matches.
    if (!isHashOperator(op) || ctx.rolloutToken === undefined) {
      return false;
    }
    return matchOperator(op, ctx.rolloutToken, operand);
  }

  if (clientKey === "runtimeVersion") {
    return matchOperator(op, ctx.runtimeVersion, operand);
  }

  return matchOperator(op, extraParamValue(ctx.extraParams, clientKey), operand);
};

export const statementChildren = (node: BranchMappingStatement): readonly BranchMappingNode[] => {
  const [, ...children] = node;
  return children;
};

export const evaluateNode = (node: BranchMappingNode, ctx: EvaluationContext): boolean => {
  if (node === "true") {
    return true;
  }
  if (isStatementNode(node)) {
    const [head] = node;
    const children = statementChildren(node);
    if (head === "and") {
      return children.every((child) => evaluateNode(child, ctx));
    }
    if (head === "or") {
      return children.some((child) => evaluateNode(child, ctx));
    }
    // "not"
    const [child] = children;
    return child === undefined ? false : !evaluateNode(child, ctx);
  }
  return evaluateLeaf(node, ctx);
};

// Does any leaf reference rolloutToken? Decides whether the hash fraction must
// be computed at all (lazy: non-rollout mappings need no easClientId).
export const referencesRolloutToken = (node: BranchMappingNode): boolean => {
  if (node === "true") {
    return false;
  }
  if (isStatementNode(node)) {
    return statementChildren(node).some(referencesRolloutToken);
  }
  return node.clientKey === "rolloutToken";
};
