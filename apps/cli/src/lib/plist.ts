import plist from "@expo/plist";

import type { PlistObject } from "@expo/plist";

export type { PlistObject, PlistValue } from "@expo/plist";

/**
 * Parse an XML plist string into a typed object.
 * Throws on malformed XML — callers should wrap in Effect.try.
 */
export const parsePlistXml = (xml: string): PlistObject => plist.parse(xml) as PlistObject;

/**
 * Parse a binary plist buffer into a typed object.
 * Uses bplist-parser for Apple's binary plist format.
 */
export const parsePlistBinary = (buffer: Buffer): PlistObject => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- bplist-parser is CJS-only
  const bplistParser = require("bplist-parser") as typeof import("bplist-parser");
  const [result] = bplistParser.parseBuffer(buffer);
  return result as PlistObject;
};

const BPLIST_MAGIC = Buffer.from("bplist00");

/**
 * Auto-detect plist format (binary vs XML) and parse accordingly.
 */
export const parsePlist = (data: Buffer): PlistObject =>
  data.subarray(0, 8).equals(BPLIST_MAGIC)
    ? parsePlistBinary(data)
    : parsePlistXml(data.toString("utf-8"));
