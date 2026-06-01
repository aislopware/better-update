// scopeKey is the per-app origin identity the device uses to partition its local
// SQLite `json_data` store (server-defined-headers + manifest-filters) AND the
// value the manifest's `extra.scopeKey` must carry so a code-signing certificate
// that embeds an Expo-project-information extension can cross-check it. Both the
// server (cache + per-(project, scopeKey) state) and the CLI (manifest render)
// MUST derive the SAME string the installed app computes, so this pure helper is
// the single shared source of truth across both ends.
//
// DEVICE TRUTH (expo-updates v1):
//   deviceScopeKey = config["EXUpdatesScopeKey"] ?? normalizedURLOrigin(updateUrl)
// scopeKey is NEVER a request header — it is reproduced from the project's
// configured update URL (or an explicit override).
//
// This module is a pure, total, sync leaf: no I/O, no Effect.

const SCHEME_DEFAULT_PORTS: Record<string, string> = {
  "http:": "80",
  "https:": "443",
};

// Reproduce the device's `normalizedURLOrigin` EXACTLY:
//   - lowercase scheme + host (URL() already lowercases both)
//   - strip path / query / fragment
//   - elide the port when it is the scheme default (80 for http, 443 for https)
//   - drop a single trailing dot on the host
//
// Guarded with URL.canParse so a malformed update URL returns the input verbatim
// instead of throwing: this keeps the function genuinely total (no uncaught
// defect can reach the manifest path or the CLI render) even if a caller wires a
// stored / user-provided update URL here. A non-parseable scope key still
// isolates correctly because it is opaque to the (project, scopeKey) tenant key +
// cache key; it simply won't equal any device-computed origin.
export const normalizedURLOrigin = (updateUrl: string): string => {
  if (!URL.canParse(updateUrl)) {
    return updateUrl;
  }
  const url = new URL(updateUrl);
  // url.protocol includes the trailing ":" e.g. "https:"
  const scheme = url.protocol;
  const host = url.hostname.replace(/\.$/u, "");
  const defaultPort = SCHEME_DEFAULT_PORTS[scheme];
  const portSuffix = url.port && url.port !== defaultPort ? `:${url.port}` : "";
  return `${scheme}//${host}${portSuffix}`;
};

export interface DeriveScopeKeyInput {
  readonly updateUrl: string;
  readonly explicitScopeKey?: string;
}

// Total derivation: an explicit `EXUpdatesScopeKey` config wins verbatim;
// otherwise the normalized origin of the update URL is returned.
// normalizedURLOrigin is URL.canParse-guarded so a malformed update URL falls
// back to the raw input rather than throwing — deriveScopeKey never throws for
// any string input, so it stays a plain sync function.
export const deriveScopeKey = (input: DeriveScopeKeyInput): string =>
  input.explicitScopeKey ?? normalizedURLOrigin(input.updateUrl);
