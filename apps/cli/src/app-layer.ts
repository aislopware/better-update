import { FetchHttpClient } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Layer } from "effect";

import { ApiClientLive } from "./services/api-client";
import { AppleSessionStoreLive } from "./services/apple-session-store";
import { AuthStoreLive } from "./services/auth-store";
import { CliRuntimeLive } from "./services/cli-runtime";
import { ConfigStoreLive } from "./services/config-store";
import { PresignedUploadClientLive } from "./services/presigned-upload";
import { UpdateAssetUploaderLive } from "./services/update-asset-uploader";
import { VersionCheckLive } from "./services/version-check";

const CliPlatformLayer = Layer.mergeAll(CliRuntimeLive, NodeContext.layer, FetchHttpClient.layer);
const CliStoreLayer = Layer.mergeAll(AuthStoreLive, ConfigStoreLive, AppleSessionStoreLive).pipe(
  Layer.provide(CliPlatformLayer),
);
const CliAdapterDependencies = Layer.mergeAll(CliPlatformLayer, CliStoreLayer);
const ApiClientLayer = ApiClientLive.pipe(Layer.provide(CliAdapterDependencies));
const PresignedUploadLayer = PresignedUploadClientLive.pipe(Layer.provide(CliPlatformLayer));
const UpdateAssetUploaderLayer = UpdateAssetUploaderLive.pipe(
  Layer.provide(Layer.mergeAll(ApiClientLayer, PresignedUploadLayer)),
);
const VersionCheckLayer = VersionCheckLive.pipe(Layer.provide(CliPlatformLayer));

export const CliLive = Layer.mergeAll(
  CliAdapterDependencies,
  ApiClientLayer,
  PresignedUploadLayer,
  UpdateAssetUploaderLayer,
  VersionCheckLayer,
);
