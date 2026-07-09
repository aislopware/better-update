import { Schema } from "effect";

import { DateTimeString, Id, UploadHeaders } from "./common";

/**
 * Crash-symbolication artifacts attached to a build or an update. Native
 * builds attach at most one artifact per type: `dsym` (iOS debug symbols,
 * zipped), `js-sourcemap` (the sourcemap of the JS bundle embedded in the
 * binary), `proguard-mapping` (Android R8/ProGuard mapping.txt) and
 * `native-symbols` (Android NDK native-debug-symbols.zip). OTA publishes
 * attach one `js-sourcemap` per update.
 */
export const DebugArtifactType = Schema.Literal(
  "dsym",
  "js-sourcemap",
  "proguard-mapping",
  "native-symbols",
);

const Sha256Hex = Schema.String.pipe(Schema.pattern(/^[a-fA-F0-9]{64}$/u), Schema.maxLength(64));

export class BuildDebugArtifact extends Schema.Class<BuildDebugArtifact>("BuildDebugArtifact")({
  buildId: Id,
  type: DebugArtifactType,
  contentType: Schema.String,
  byteSize: Schema.Number,
  sha256: Schema.String,
  createdAt: DateTimeString,
}) {}

export class UpdateSourcemap extends Schema.Class<UpdateSourcemap>("UpdateSourcemap")({
  updateId: Id,
  byteSize: Schema.Number,
  sha256: Schema.String,
  createdAt: DateTimeString,
}) {}

export const ReserveDebugArtifactBody = Schema.Struct({
  type: DebugArtifactType,
  sha256: Sha256Hex,
  byteSize: Schema.Number.pipe(Schema.nonNegative()),
});

export const CompleteDebugArtifactBody = Schema.Struct({
  type: DebugArtifactType,
  sha256: Sha256Hex,
  byteSize: Schema.Number.pipe(Schema.nonNegative()),
});

export const ReserveSourcemapBody = Schema.Struct({
  sha256: Sha256Hex,
  byteSize: Schema.Number.pipe(Schema.nonNegative()),
});

// Same shape as the reserve body, but a distinct schema (not an alias) so the
// two endpoint contracts can evolve independently.
export const CompleteSourcemapBody = Schema.Struct({
  sha256: Sha256Hex,
  byteSize: Schema.Number.pipe(Schema.nonNegative()),
});

export const DebugUploadReservation = Schema.Struct({
  uploadUrl: Schema.String,
  uploadExpiresAt: DateTimeString,
  uploadHeaders: UploadHeaders,
});

export const ListDebugArtifactsResult = Schema.Struct({
  items: Schema.Array(BuildDebugArtifact),
});

/** Short-lived presigned GET URL for downloading a debug artifact/sourcemap. */
export const DebugDownloadResult = Schema.Struct({
  url: Schema.String,
  expiresAt: DateTimeString,
});
