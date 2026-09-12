import { NodeServices } from "@effect/platform-node";
import { Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

import { GlobalFlagsLayer } from "./lib/global-flags";
import { ApiClientLive } from "./services/api-client";
import { AppleAuthLive } from "./services/apple-auth";
import { AppleSessionStoreLive } from "./services/apple-session-store";
import { AuthStoreLive } from "./services/auth-store";
import { BsdiffServiceLive } from "./services/bsdiff";
import { CliRuntimeLive } from "./services/cli-runtime";
import { ConfigStoreLive } from "./services/config-store";
import { DeviceUnlockMemoLive } from "./services/device-unlock-memo";
import { IdentityStoreLive } from "./services/identity-store";
import { MinVersionCheckLive } from "./services/min-version-check";
import { PatchUploaderLive } from "./services/patch-uploader";
import { PresignedDownloadClientLive } from "./services/presigned-download";
import { PresignedUploadClientLive } from "./services/presigned-upload";
import { UpdateAssetUploaderLive } from "./services/update-asset-uploader";
import { VaultCacheLive } from "./services/vault-cache";
import { VersionCheckLive } from "./services/version-check";

const CliPlatformLayer = Layer.mergeAll(CliRuntimeLive, NodeServices.layer, FetchHttpClient.layer);
const CliStoreLayer = Layer.mergeAll(
  AuthStoreLive,
  ConfigStoreLive,
  AppleSessionStoreLive,
  IdentityStoreLive,
  VaultCacheLive,
  // Process-scoped: built once per command run, so every vault unlock in that
  // run shares one passphrase prompt.
  DeviceUnlockMemoLive,
).pipe(Layer.provide(CliPlatformLayer));
const CliAdapterDependencies = Layer.mergeAll(CliPlatformLayer, CliStoreLayer);
const ApiClientLayer = ApiClientLive.pipe(Layer.provide(CliAdapterDependencies));
const AppleAuthLayer = AppleAuthLive.pipe(Layer.provide(CliAdapterDependencies));
const PresignedUploadLayer = PresignedUploadClientLive.pipe(Layer.provide(CliPlatformLayer));
const UpdateAssetUploaderLayer = UpdateAssetUploaderLive.pipe(
  Layer.provide(Layer.mergeAll(ApiClientLayer, PresignedUploadLayer)),
);
const PresignedDownloadLayer = PresignedDownloadClientLive.pipe(Layer.provide(CliPlatformLayer));
const PatchUploaderLayer = PatchUploaderLive.pipe(
  Layer.provide(Layer.mergeAll(ApiClientLayer, PresignedUploadLayer)),
);
const VersionCheckLayer = VersionCheckLive.pipe(Layer.provide(CliPlatformLayer));
const MinVersionCheckLayer = MinVersionCheckLive.pipe(Layer.provide(CliAdapterDependencies));

/**
 * Every service a command handler can require. `OutputMode` + `InteractiveMode`
 * derive from the parsed global flags, so this layer is provided to the root
 * command (`Command.provide`) where the parser's `Setting` services are in scope.
 */
export const CliLive = Layer.mergeAll(
  CliAdapterDependencies,
  ApiClientLayer,
  AppleAuthLayer,
  PresignedUploadLayer,
  UpdateAssetUploaderLayer,
  PresignedDownloadLayer,
  PatchUploaderLayer,
  BsdiffServiceLive,
  VersionCheckLayer,
  MinVersionCheckLayer,
  GlobalFlagsLayer.pipe(Layer.provide(CliPlatformLayer)),
);

/** The background version-cache refresh runs without a parsed command line. */
export const MaintenanceLive = Layer.mergeAll(VersionCheckLayer, CliRuntimeLive);
