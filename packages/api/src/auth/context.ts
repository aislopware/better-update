import { Context } from "effect";

export type Role = "owner" | "admin" | "developer" | "viewer";

export type Resource =
  | "organization"
  | "member"
  | "invitation"
  | "project"
  | "channel"
  | "branch"
  | "update"
  | "rollout"
  | "billing"
  | "apiKey"
  | "build"
  | "credential";

export type Action = "read" | "create" | "update" | "delete" | "cancel" | "download";

export type EffectivePermissions = Partial<Record<Resource, readonly Action[]>>;

export interface AuthContextShape {
  readonly userId: string | null;
  readonly organizationId: string;
  readonly role: Role | null;
  readonly effectivePermissions: EffectivePermissions;
  readonly source: "session" | "api-key";
}

export class AuthContext extends Context.Tag("api/AuthContext")<AuthContext, AuthContextShape>() {}
