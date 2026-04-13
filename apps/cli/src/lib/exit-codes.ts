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
