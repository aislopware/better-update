export interface DotenvEntry {
  readonly key: string;
  readonly value: string;
}

const INLINE_COMMENT = /\s+#.*$/u;

const stripWrappingQuotes = (value: string): string => {
  const [quote] = value;
  if ((quote !== '"' && quote !== "'") || !value.endsWith(quote)) {
    return value;
  }
  const inner = value.slice(1, -1);
  return quote === '"'
    ? inner
        .replaceAll(String.raw`\n`, "\n")
        .replaceAll(String.raw`\r`, "\r")
        .replaceAll(String.raw`\t`, "\t")
    : inner;
};

const parseDotenvValue = (raw: string): string => {
  const trimmed = raw.trim();
  const [quote] = trimmed;
  return quote === '"' || quote === "'"
    ? stripWrappingQuotes(trimmed)
    : trimmed.replace(INLINE_COMMENT, "").trim();
};

const stripExportPrefix = (line: string): string =>
  line.startsWith("export ") ? line.slice("export ".length).trimStart() : line;

const parseDotenvLine = (line: string): DotenvEntry | null => {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith("#")) {
    return null;
  }

  const withoutExport = stripExportPrefix(trimmed);
  const separatorIndex = withoutExport.indexOf("=");
  if (separatorIndex < 1) {
    return null;
  }

  const key = withoutExport.slice(0, separatorIndex).trim();
  if (key.length === 0) {
    return null;
  }

  return {
    key,
    value: parseDotenvValue(withoutExport.slice(separatorIndex + 1)),
  };
};

export const parseDotenvEntries = (content: string): readonly DotenvEntry[] =>
  content.split(/\r?\n/u).flatMap((line) => {
    const entry = parseDotenvLine(line);
    return entry === null ? [] : [entry];
  });

export const parseDotenvContent = (content: string): Record<string, string> =>
  Object.fromEntries(parseDotenvEntries(content).map(({ key, value }) => [key, value]));
