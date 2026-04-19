import { addServerDefinedHeaders } from "../protocol/headers";

import type { ProtocolHeaders } from "../protocol/headers";
import type { UpdateRow } from "../repositories/manifest";
import type { ResponseType } from "./manifest-cache";

export type TrackManifestResponse = (
  branchId: string,
  updateId: string,
  responseType: ResponseType,
) => void;

export const responseTypeFor = (update: Pick<UpdateRow, "is_rollback">): ResponseType =>
  update.is_rollback === 1 ? "directive" : "manifest";

export const respond = (response: Response, ph: ProtocolHeaders) =>
  addServerDefinedHeaders(response, ph.extraParams);
