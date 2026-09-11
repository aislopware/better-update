import { Schema } from "effect";

import { DateTimeString, Id, UploadHeaders } from "./common";

const Sha256Hex = Schema.String.check(
  Schema.isPattern(/^[a-fA-F0-9]{64}$/u),
  Schema.isMaxLength(64),
);

/**
 * Device-installable companion of an Android App Bundle build. Google Play
 * takes the `.aab`; a phone cannot install one. The CLI builds a universal APK
 * from the same Gradle run, signed with the same upload key, and attaches it
 * here so the dashboard's install link and `builds run` have something a device
 * accepts. At most one per build.
 */
export const BuildInstallArtifact = Schema.Struct({
  r2Key: Schema.String,
  contentType: Schema.String,
  byteSize: Schema.Number,
  sha256: Schema.String,
  createdAt: DateTimeString,
}).annotate({ identifier: "BuildInstallArtifact" });
export type BuildInstallArtifact = typeof BuildInstallArtifact.Type;

export const ReserveInstallArtifactBody = Schema.Struct({
  sha256: Sha256Hex,
  byteSize: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
});

// Same shape as the reserve body, but a distinct schema (not an alias) so the
// two endpoint contracts can evolve independently.
export const CompleteInstallArtifactBody = Schema.Struct({
  sha256: Sha256Hex,
  byteSize: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
});

export const InstallArtifactUploadReservation = Schema.Struct({
  uploadUrl: Schema.String,
  uploadExpiresAt: DateTimeString,
  uploadHeaders: UploadHeaders,
});

export const CompleteInstallArtifactResult = Schema.Struct({
  buildId: Id,
  ...BuildInstallArtifact.fields,
}).annotate({ identifier: "CompleteInstallArtifactResult" });
