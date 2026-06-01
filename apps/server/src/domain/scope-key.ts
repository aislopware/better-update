// scopeKey derivation now lives in the shared pure leaf package
// `@better-update/expo-protocol` so the server (manifest cache + per-tenant
// state) and the CLI (which injects `extra.scopeKey` into the rendered manifest)
// derive the byte-identical, device-matching origin from ONE source and can never
// drift. Re-exported here to keep the server's existing import path
// (`../domain/scope-key`) stable.
//
// `domain/` stays pure: the package is a sync, total, no-I/O helper (URL parsing
// only), matching how domain/ already consumes @better-update/expo-codesign etc.
export { deriveScopeKey, normalizedURLOrigin } from "@better-update/expo-protocol";
export type { DeriveScopeKeyInput } from "@better-update/expo-protocol";
