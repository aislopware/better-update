import { Schema } from "effect";

export const MeUser = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
});

export const MeOrganization = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  role: Schema.NullOr(Schema.String),
});

export const Me = Schema.Struct({
  user: Schema.NullOr(MeUser),
  activeOrganization: Schema.NullOr(MeOrganization),
  /** Authentication source — "session" for browser + CLI sessions, "api-key" for API-key (CI) bearer tokens. */
  source: Schema.Literal("session", "api-key"),
  /** Email or descriptor identifying the actor — useful when `user` is null (api-key auth). */
  actorEmail: Schema.String,
});
