export type JsonParseResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false };

export const parseJsonResult = (text: string): JsonParseResult => {
  // eslint-disable-next-line functional/no-try-statements -- JSON.parse exposes syntax errors via throw; this helper converts them to an explicit result value
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
};

export const safeJsonParse = (text: string): unknown => {
  const result = parseJsonResult(text);
  return result.ok ? result.value : null;
};
