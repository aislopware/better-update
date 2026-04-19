const readField = (source: unknown, field: string): unknown => {
  if (typeof source !== "object" || source === null) {
    return undefined;
  }
  return Reflect.get(source, field);
};

export const r2Checksums = (object: unknown): unknown => readField(object, "checksums");

export const r2ListCursor = (listed: unknown): string | undefined => {
  const value = readField(listed, "cursor");
  return typeof value === "string" ? value : undefined;
};
