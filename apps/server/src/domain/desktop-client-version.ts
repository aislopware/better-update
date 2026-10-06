/**
 * The version of the app asking a desktop feed, from what each updater sends
 * on its own — nothing to configure. Pure.
 *
 * - Sparkle: `User-Agent: <App>/<CFBundleShortVersionString> Sparkle/<v>`
 * - WinSparkle: `User-Agent: <App>/<version> WinSparkle/<v>`
 * - electron-updater: Electron's default user agent, which carries
 *   `<App>/<version>` just before `Chrome/…`.
 * - Tauri: nothing by default; an endpoint templated with
 *   `current_version={{current_version}}` names it.
 */

/** A version as updaters print it: a digit first, then semver-ish characters. */
const VERSION = String.raw`\d[0-9A-Za-z.+-]{0,63}`;

const SPARKLE_AGENT = new RegExp(
  String.raw`(?:^|\s)[^\s/]+/(?<version>${VERSION}) (?:Win)?Sparkle/`,
  "u",
);
const ELECTRON_AGENT = new RegExp(
  String.raw`\s[^\s/]+/(?<version>${VERSION}) Chrome/\S+ Electron/`,
  "u",
);
const QUERY_VERSION = new RegExp(String.raw`^v?${VERSION}$`, "u");

export const desktopClientVersion = (request: {
  readonly userAgent: string | null;
  readonly query: URLSearchParams;
}): string | undefined => {
  const fromQuery = request.query.get("current_version") ?? request.query.get("appVersion");
  if (fromQuery !== null && QUERY_VERSION.test(fromQuery)) {
    return fromQuery.replace(/^v/u, "");
  }
  const agent = request.userAgent;
  return agent === null
    ? undefined
    : (SPARKLE_AGENT.exec(agent)?.groups?.["version"] ??
        ELECTRON_AGENT.exec(agent)?.groups?.["version"]);
};
