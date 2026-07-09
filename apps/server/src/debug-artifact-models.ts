// Crash-symbolication artifact models — split from ./models to stay under the
// max-lines budget there (mirrors ./submission-models, ./env-var-models).

export type DebugArtifactType = "dsym" | "js-sourcemap" | "proguard-mapping" | "native-symbols";

export interface BuildDebugArtifactModel {
  readonly buildId: string;
  readonly type: DebugArtifactType;
  readonly r2Key: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly createdAt: string;
}

export interface UpdateSourcemapModel {
  readonly updateId: string;
  readonly r2Key: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly createdAt: string;
}
