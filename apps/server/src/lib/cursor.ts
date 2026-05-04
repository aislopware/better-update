export interface Cursor {
  readonly createdAt: string;
  readonly id: string;
}

export const encodeCursor = (cursor: Cursor): string => btoa(JSON.stringify(cursor));

export const decodeCursor = (encoded: string): Cursor | null => {
  // eslint-disable-next-line functional/no-try-statements -- boundary parser: atob + JSON.parse expose untrusted-input failures via throw; this helper converts them to a null result
  try {
    const parsed: unknown = JSON.parse(atob(encoded));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "createdAt" in parsed &&
      typeof parsed.createdAt === "string" &&
      "id" in parsed &&
      typeof parsed.id === "string"
    ) {
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
};

export const parseCursorPagination = (
  params: { readonly cursor?: string | undefined; readonly limit?: number | undefined },
  defaultLimit = 50,
  maxLimit = 100,
) => ({
  cursor: params.cursor ? decodeCursor(params.cursor) : null,
  limit: Math.max(1, Math.min(params.limit ?? defaultLimit, maxLimit)),
});
