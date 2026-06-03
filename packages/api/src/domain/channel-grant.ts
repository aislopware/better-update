import { Schema } from "effect";

import { DateTimeString, Id } from "./common";

export const GrantEffectSchema = Schema.Literal("allow", "deny");

/** One member's allow/deny set on a channel; `actions` are "resource:action". */
export class ChannelGrant extends Schema.Class<ChannelGrant>("ChannelGrant")({
  id: Id,
  memberId: Id,
  scopeKind: Schema.Literal("channel"),
  scopeId: Id,
  effect: GrantEffectSchema,
  actions: Schema.Array(Schema.String),
  createdAt: DateTimeString,
}) {}

/** Upsert one (member, channel, effect) grant. effect defaults to "allow". */
export const UpsertChannelGrantBody = Schema.Struct({
  effect: Schema.optionalWith(GrantEffectSchema, { default: () => "allow" as const }),
  actions: Schema.Array(Schema.String).pipe(Schema.minItems(1)),
});

export const ListChannelGrantsParams = Schema.Struct({});

export const DeleteChannelGrantResult = Schema.Struct({ deleted: Schema.Number });
