// scopeKey is the per-app origin identity the device uses to partition its
// local SQLite `json_data` store (server-defined-headers + manifest-filters).
// The server MUST derive the SAME string so per-(project, scopeKey) state and
// the manifest cache line up with what each installed app computes.
//
// DEVICE TRUTH (expo-updates v1):
//   deviceScopeKey = config["EXUpdatesScopeKey"] ?? normalizedURLOrigin(updateUrl)
// scopeKey is NEVER a request header — the server reproduces it from the
// project's configured update URL (or an explicit override) instead. Keep this
// function the single source of truth: the migration backfill, the CLI, and any
// future origin-matching all derive scopeKey through here.
//
// `domain/` may only import `effect` + `models` — this file imports neither and
// stays a pure, total, sync helper.

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
// Guarded with URL.canParse so a malformed update URL returns the input
// verbatim instead of throwing: this keeps the function genuinely total (no
// uncaught defect can reach the manifest path) even if a future caller wires a
// stored / user-provided update URL here, not just the wrangler-controlled
// `${PUBLIC_API_URL}/manifest/<id>` shape. A non-parseable scope key still
// isolates correctly because it is opaque to the (project, scopeKey) tenant key
// + cache key; it simply won't equal any device-computed origin.
const normalizedURLOrigin = (updateUrl: string): string => {
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
// any string input, so it stays a plain sync function and the manifest handler
// can fall back to the PUBLIC_API_URL origin without an error path.
export const deriveScopeKey = (input: DeriveScopeKeyInput): string =>
  input.explicitScopeKey ?? normalizedURLOrigin(input.updateUrl);
