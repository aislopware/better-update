// The pure `buildManifest` + `buildExtensions` render now live in the shared
// `@better-update/expo-protocol` package so the CLI (which signs the rendered
// bytes) and the server (which serves them verbatim) render byte-identical JSON
// and can never drift. Re-export them here to keep the server's import path
// (handlers/manifest.ts) stable.
//
// `buildDirective` stays server-only: it builds the unsigned `rollBackToEmbedded`
// directive served on the rollback path, and is not part of the CLI signed-render
// flow (RSA SDK56 signed rollback is out of scope for this cluster).
export { buildExtensions, buildManifest } from "@better-update/expo-protocol";

interface UpdateData {
  readonly id: string;
  readonly createdAt: string;
  readonly runtimeVersion: string;
  readonly metadata: Record<string, unknown>;
  readonly extra: Record<string, unknown> | undefined;
}

export const buildDirective = (params: { readonly update: UpdateData }): object => ({
  type: "rollBackToEmbedded",
  parameters: {
    commitTime: params.update.createdAt,
  },
});
