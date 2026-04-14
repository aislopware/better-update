import type { Forbidden, OrgRequired, Unauthorized } from "./errors/auth";
import type { BadRequest, Conflict, NotAcceptable, NotFound } from "./errors/common";

export { Forbidden, OrgRequired, Unauthorized } from "./errors/auth";
export { BadRequest, Conflict, NotAcceptable, NotFound } from "./errors/common";

export type AppError =
  | BadRequest
  | Conflict
  | Forbidden
  | NotAcceptable
  | NotFound
  | OrgRequired
  | Unauthorized;
