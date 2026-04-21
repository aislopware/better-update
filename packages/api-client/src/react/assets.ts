import type { AssetUploadBody } from "@better-update/api";

import { runApi } from "../index";

export const uploadAssets = async (body: typeof AssetUploadBody.Type) =>
  runApi((api) => api.assets.upload({ payload: body }));

export const finalizeAsset = async (hash: string) =>
  runApi((api) => api.assets.finalize({ path: { hash } }));
