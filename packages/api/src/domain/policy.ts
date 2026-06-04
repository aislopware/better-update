import { Schema } from "effect";

import { DateTimeString, Id } from "./common";

/** Whether a statement grants or denies the matched actions. */
export const PolicyEffect = Schema.Literal("allow", "deny");
export type PolicyEffectValue = typeof PolicyEffect.Type;

// A single permission statement inside a policy document. `actions` are
// "resource:action" / "resource:*" / "*" tokens; `resources` are path-glob
// selectors ("*", "project/A", "project/*/env/production"). The server
// validates action tokens against the real resource/action vocabulary and
// selectors against the shared selector grammar.
export const PolicyStatement = Schema.Struct({
  effect: PolicyEffect,
  actions: Schema.Array(Schema.String).pipe(Schema.minItems(1)),
  resources: Schema.Array(Schema.String).pipe(Schema.minItems(1)),
});

export const PolicyDocument = Schema.Struct({
  statements: Schema.Array(PolicyStatement),
});

export class Policy extends Schema.Class<Policy>("Policy")({
  id: Id,
  organizationId: Id,
  name: Schema.NonEmptyString,
  description: Schema.NullOr(Schema.String),
  document: PolicyDocument,
  createdAt: DateTimeString,
  updatedAt: Schema.NullOr(DateTimeString),
}) {}

export const CreatePolicyBody = Schema.Struct({
  name: Schema.NonEmptyString,
  description: Schema.optional(Schema.String),
  document: PolicyDocument,
});

export const UpdatePolicyBody = Schema.Struct({
  name: Schema.optional(Schema.NonEmptyString),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  document: Schema.optional(PolicyDocument),
});
