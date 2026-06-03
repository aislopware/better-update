import { Schema } from "effect";

import { DateTimeString, DeletedResult, Id } from "./common";

export const AndroidPackageName = Schema.String.pipe(
  Schema.pattern(/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/u, {
    message: () => "Package name must be reverse-domain style (e.g., com.acme.app)",
  }),
);

export class AndroidApplicationIdentifier extends Schema.Class<AndroidApplicationIdentifier>(
  "AndroidApplicationIdentifier",
)({
  id: Id,
  organizationId: Id,
  projectId: Id,
  packageName: Schema.String,
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}) {}

export const CreateAndroidApplicationIdentifierBody = Schema.Struct({
  packageName: AndroidPackageName,
});

export const DeleteAndroidApplicationIdentifierResult = DeletedResult;
