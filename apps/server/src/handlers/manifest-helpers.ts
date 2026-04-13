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

export const createTracker = (params: {
  readonly env: Env;
  readonly projectId: string;
  readonly ph: ProtocolHeaders;
  readonly startTime: number;
}): TrackManifestResponse => {
  const { env, projectId, ph, startTime } = params;
  return (branchId, updateId, responseType) => {
    env.ANALYTICS.writeDataPoint({
      indexes: [`${projectId}:${ph.easClientId ?? crypto.randomUUID()}`],
      blobs: [
        projectId,
        ph.channelName,
        branchId,
        updateId,
        ph.platform,
        ph.runtimeVersion,
        responseType,
        ph.extraParams ?? "",
      ],
      doubles: [Date.now() - startTime, 0],
    });
  };
};

export const respond = (response: Response, ph: ProtocolHeaders) =>
  addServerDefinedHeaders(response, ph.extraParams);
