/* eslint-disable eslint/max-classes-per-file -- dedicated error-taxonomy module: each error class is a small, purpose-built tag used across the CLI for Effect.catchTag */

import { Data } from "effect";

export class AuthRequiredError extends Data.TaggedError("AuthRequiredError")<{
  readonly message: string;
}> {}

export class ProjectNotLinkedError extends Data.TaggedError("ProjectNotLinkedError")<{
  readonly message: string;
}> {}

export class UploadFailedError extends Data.TaggedError("UploadFailedError")<{
  readonly message: string;
}> {}

export class BuildProfileError extends Data.TaggedError("BuildProfileError")<{
  readonly message: string;
}> {}

export class RuntimeVersionError extends Data.TaggedError("RuntimeVersionError")<{
  readonly message: string;
}> {}

export class MissingCredentialsError extends Data.TaggedError("MissingCredentialsError")<{
  readonly message: string;
  readonly hint: string;
}> {}

export class BuildFailedError extends Data.TaggedError("BuildFailedError")<{
  readonly step: string;
  readonly exitCode: number;
  readonly message: string;
}> {}

export class ReserveError extends Data.TaggedError("ReserveError")<{
  readonly message: string;
}> {}

export class CompleteError extends Data.TaggedError("CompleteError")<{
  readonly message: string;
}> {}

export class PresignedUrlExpiredError extends Data.TaggedError("PresignedUrlExpiredError")<{
  readonly message: string;
}> {}

export class ArtifactNotFoundError extends Data.TaggedError("ArtifactNotFoundError")<{
  readonly message: string;
}> {}

export class KeychainError extends Data.TaggedError("KeychainError")<{
  readonly message: string;
}> {}

export class ProvisioningError extends Data.TaggedError("ProvisioningError")<{
  readonly message: string;
}> {}

export class XcodeProjectError extends Data.TaggedError("XcodeProjectError")<{
  readonly message: string;
}> {}

export class EnvExportError extends Data.TaggedError("EnvExportError")<{
  readonly message: string;
}> {}

export class UpdatePublishError extends Data.TaggedError("UpdatePublishError")<{
  readonly message: string;
}> {}

export class UpdateRollbackError extends Data.TaggedError("UpdateRollbackError")<{
  readonly message: string;
}> {}

export class UpdatePromoteError extends Data.TaggedError("UpdatePromoteError")<{
  readonly message: string;
}> {}

export class CredentialValidationError extends Data.TaggedError("CredentialValidationError")<{
  readonly message: string;
}> {}

export class IdentityError extends Data.TaggedError("IdentityError")<{
  readonly message: string;
}> {}

export class AppleAuthError extends Data.TaggedError("AppleAuthError")<{
  readonly message: string;
}> {}

export class InvalidArgumentError extends Data.TaggedError("InvalidArgumentError")<{
  readonly message: string;
}> {}

export class InteractiveProhibitedError extends Data.TaggedError("InteractiveProhibitedError")<{
  readonly message: string;
}> {}

export class CredentialsJsonError extends Data.TaggedError("CredentialsJsonError")<{
  readonly message: string;
}> {}

export class DirtyRepoError extends Data.TaggedError("DirtyRepoError")<{
  readonly message: string;
}> {}

export class StagingError extends Data.TaggedError("StagingError")<{
  readonly message: string;
}> {}
