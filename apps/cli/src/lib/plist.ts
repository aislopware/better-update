import plistMod from "@expo/plist";
import { parseBuffer as parseBplistBuffer } from "bplist-parser";

import type { PlistObject } from "@expo/plist";

export type { PlistObject } from "@expo/plist";

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
 * Uses bplist-parser for Apple's binary plist format. The parser returns the
 * top-level object wrapped in a one-element array; `PlistObject` is the shape
 * every caller consumes, so it is the type argument rather than a cast.
 */
export const parsePlistBinary = (buffer: Buffer): PlistObject => {
  const [result] = parseBplistBuffer<PlistObject>(buffer);
  return result;
};

const BPLIST_MAGIC = Buffer.from("bplist00");

/**
 * Auto-detect plist format (binary vs XML) and parse accordingly.
 */
export const parsePlist = (data: Buffer): PlistObject =>
  data.subarray(0, 8).equals(BPLIST_MAGIC)
    ? parsePlistBinary(data)
    : parsePlistXml(data.toString("utf8"));
