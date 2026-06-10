import plistMod from "@expo/plist";

import type { PlistObject } from "@expo/plist";
// eslint-disable-next-line import-plugin/no-namespace -- bplist-parser typings have no named export; used only as `typeof BplistParser` for the CJS require result
import type * as BplistParser from "bplist-parser";

export type { PlistObject, PlistValue } from "@expo/plist";

// `@expo/plist`'s CJS build sets `exports.default = { parse, build }`. Node's
// ESM-CJS interop does NOT auto-unwrap that `.default` (Bun does), so a plain
// `plistMod.parse` is undefined under Node. Reach into `.default` when needed
// so the CLI works under both runtimes.
const plist =
  typeof (plistMod as { parse?: unknown }).parse === "function"
    ? plistMod
    : // eslint-disable-next-line typescript/no-unsafe-type-assertion -- runtime shim for Node ESM-CJS default-export interop
      (plistMod as unknown as { default: typeof plistMod }).default;

/**
 * Parse an XML plist string into a typed object.
 * Throws on malformed XML — callers should wrap in Effect.try.
 */
export const parsePlistXml = (xml: string): PlistObject =>
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- @expo/plist.parse returns `any`; PlistObject is the library's declared shape for XML plists
  plist.parse(xml) as PlistObject;

/**
 * Serialize an object into XML plist text.
 */
export const buildPlistXml = (value: PlistObject): string => plist.build(value);

/**
 * Parse a binary plist buffer into a typed object.
 * Uses bplist-parser for Apple's binary plist format.
 */
export const parsePlistBinary = (buffer: Buffer): PlistObject => {
  const bplistParser =
    // eslint-disable-next-line typescript/no-unsafe-type-assertion -- CJS require returns `any`; narrow to the package's own typings at the boundary
    require("bplist-parser") as typeof BplistParser;
  // eslint-disable-next-line typescript/no-unsafe-assignment -- bplist-parser typings declare parseBuffer<T>(): T[] with T=any in the shipped .d.ts
  const [result] = bplistParser.parseBuffer(buffer);
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- bplist-parser typings return `any[]`; PlistObject is the superset shape we consume
  return result as PlistObject;
};

const BPLIST_MAGIC = Buffer.from("bplist00");

/**
 * Auto-detect plist format (binary vs XML) and parse accordingly.
 */
export const parsePlist = (data: Buffer): PlistObject =>
  data.subarray(0, 8).equals(BPLIST_MAGIC)
    ? parsePlistBinary(data)
    : parsePlistXml(data.toString("utf8"));
