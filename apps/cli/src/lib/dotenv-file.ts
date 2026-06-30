/** Escape a string so it can be embedded as a literal inside a RegExp. */
const escapeRegExp = (value: string): string =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

/**
 * Set or append `KEY=value` in a `.env` file body, mirroring the line-based
 * reader used by react-native-config (`dotenv.gradle` on Android,
 * `BuildDotenvConfig.rb` on iOS): values are written raw and single-line, an
 * existing key is replaced in place, a new key is appended at the end. Returns
 * the updated body.
 */
export const setEnvVar = (content: string, key: string, value: string): string => {
  const re = new RegExp(String.raw`^${escapeRegExp(key)}=.*$`, "mu");
  return re.test(content)
    ? content.replace(re, `${key}=${value}`)
    : `${content.replace(/\n*$/u, "")}\n${key}=${value}\n`;
};

/** Apply a batch of `KEY=value` upserts in order (later entries win on a dup key). */
export const setEnvVars = (
  content: string,
  entries: readonly (readonly [key: string, value: string])[],
): string => entries.reduce((acc, [key, value]) => setEnvVar(acc, key, value), content);
