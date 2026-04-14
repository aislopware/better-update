import { FetchHttpClient } from "@effect/platform";
import { BunContext } from "@effect/platform-bun";
import { Layer } from "effect";

import { ApiClientLive } from "./services/api-client";
import { AuthStoreLive } from "./services/auth-store";
import { CliRuntimeLive } from "./services/cli-runtime";
import { ConfigStoreLive } from "./services/config-store";
import { PresignedUploadClientLive } from "./services/presigned-upload";
import { UpdateAssetUploaderLive } from "./services/update-asset-uploader";

const CliPlatformLayer = Layer.mergeAll(CliRuntimeLive, BunContext.layer, FetchHttpClient.layer);
const CliStoreLayer = Layer.mergeAll(AuthStoreLive, ConfigStoreLive).pipe(
  Layer.provide(CliPlatformLayer),
);
const CliAdapterDependencies = Layer.mergeAll(CliPlatformLayer, CliStoreLayer);

export const CliLive = Layer.mergeAll(
  CliAdapterDependencies,
  ApiClientLive.pipe(Layer.provide(CliAdapterDependencies)),
  PresignedUploadClientLive.pipe(Layer.provide(CliPlatformLayer)),
  UpdateAssetUploaderLive.pipe(Layer.provide(CliAdapterDependencies)),
);
