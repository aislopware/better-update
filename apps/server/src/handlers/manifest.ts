import { Effect } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { evaluateBranchMapping } from "../domain/branch-mapping";
import { resolveUpdateRollout } from "../domain/update-rollout";
import { parseProtocolHeaders } from "../protocol/headers";
import { buildDirective, buildExtensions, buildManifest } from "../protocol/manifest-builder";
import { encodeMultipart } from "../protocol/multipart";
import { ManifestRepo, ManifestRepoLive } from "../repositories/manifest";

import type { ProtocolHeaders } from "../protocol/headers";
import type { Part } from "../protocol/multipart";
import type { AssetRow, ChannelRow, UpdateRow } from "../repositories/manifest";

type ResponseType = "manifest" | "directive" | "no_update";

// -- Common protocol headers (required on ALL responses) ---------------------

const COMMON_HEADERS: Record<string, string> = {
  "expo-protocol-version": "1",
  "expo-sfv-version": "0",
  "cache-control": "private, max-age=0",
};

// -- Response helpers --------------------------------------------------------

const protocolResponse = (body: string | null, status: number, headers?: Record<string, string>) =>
  new Response(body, { status, headers: { ...COMMON_HEADERS, ...headers } });

const jsonError = (status: number, code: string, message: string) =>
  protocolResponse(JSON.stringify({ code, message }), status, {
    "content-type": "application/json",
  });

const noContent = () => protocolResponse(null, 204);

const multipartResponse = (boundary: string, parts: readonly Part[]) =>
  protocolResponse(encodeMultipart(boundary, parts), 200, {
    "content-type": `multipart/mixed; boundary=${boundary}`,
  });

const jsonManifestResponse = (manifestJson: string, signature: string | undefined) =>
  protocolResponse(manifestJson, 200, {
    "content-type": "application/expo+json",
    ...(signature ? { "expo-signature": signature } : {}),
  });

// -- Accept negotiation ------------------------------------------------------

const supportsMultipart = (accept: string) =>
  accept.includes("multipart/mixed") || accept.includes("*/*");

const supportsAny = (accept: string) =>
  supportsMultipart(accept) ||
  accept.includes("application/expo+json") ||
  accept.includes("application/json");

// -- Part builders -----------------------------------------------------------

const signedPart = (name: string, body: string, signature: string | undefined): Part => ({
  name,
  contentType: "application/json",
  ...(signature ? { headers: { "expo-signature": signature } } : {}),
  body,
});

const extensionsPart: Part = {
  name: "extensions",
  contentType: "application/json",
  body: JSON.stringify(buildExtensions()),
};

const signatureFor = (ph: ProtocolHeaders, update: UpdateRow) =>
  ph.expectSignature ? (update.signature ?? undefined) : undefined;

const certChainParts = (ph: ProtocolHeaders, update: UpdateRow): readonly Part[] =>
  ph.expectSignature && update.certificate_chain
    ? [
        {
          name: "certificate_chain",
          contentType: "application/x-pem-file",
          body: update.certificate_chain,
        },
      ]
    : [];

// eslint-disable-next-line typescript/no-unsafe-type-assertion -- D1 JSON columns are trusted application data
const parseJson = (raw: string) => JSON.parse(raw) as Record<string, unknown>;

// -- Response builders (extracted to stay within max-statements) --------------

const buildDirectiveResponse = (update: UpdateRow, ph: ProtocolHeaders, boundary: string) => {
  const directiveJson = update.directive_body
    ? parseJson(update.directive_body)
    : buildDirective({
        update: {
          id: update.id,
          createdAt: update.created_at,
          runtimeVersion: update.runtime_version,
          metadata: {},
          extra: undefined,
        },
      });

  return multipartResponse(boundary, [
    signedPart("directive", JSON.stringify(directiveJson), signatureFor(ph, update)),
    ...certChainParts(ph, update),
    extensionsPart,
  ]);
};

const buildManifestFromData = (params: {
  readonly update: UpdateRow;
  readonly assetRows: readonly AssetRow[];
  readonly scopeKey: string;
  readonly assetBaseUrl: string;
  readonly ph: ProtocolHeaders;
  readonly boundary: string;
  readonly useMultipart: boolean;
}) => {
  const { update, assetRows, scopeKey, assetBaseUrl, ph, boundary, useMultipart } = params;
  const manifestStr = JSON.stringify(
    buildManifest({
      update: {
        id: update.id,
        createdAt: update.created_at,
        runtimeVersion: update.runtime_version,
        metadata: parseJson(update.metadata_json),
        extra: update.extra_json ? parseJson(update.extra_json) : undefined,
      },
      assets: assetRows.map((row) => ({
        key: row.asset_key,
        hash: row.hash,
        contentType: row.content_type,
        fileExt: row.file_ext,
        isLaunch: row.is_launch === 1,
      })),
      scopeKey,
      assetBaseUrl,
    }),
  );

  const sig = signatureFor(ph, update);
  if (!useMultipart) {
    return jsonManifestResponse(manifestStr, sig);
  }

  return multipartResponse(boundary, [
    signedPart("manifest", manifestStr, sig),
    ...certChainParts(ph, update),
    extensionsPart,
  ]);
};

// -- Rollout resolution ------------------------------------------------------

const resolveRolledOutUpdate = (params: {
  readonly candidates: readonly UpdateRow[];
  readonly easClientId: string | undefined;
  readonly branchId: string;
  readonly platform: string;
  readonly runtimeVersion: string;
}): Effect.Effect<UpdateRow | null, never, ManifestRepo> =>
  Effect.gen(function* () {
    const rolloutResult = yield* Effect.promise(async () =>
      resolveUpdateRollout(params.candidates, params.easClientId),
    );

    if (rolloutResult === null) {
      return null;
    }

    if (rolloutResult.resolved) {
      return rolloutResult.update;
    }

    if (rolloutResult.needsFallbackQuery) {
      const repo = yield* ManifestRepo;
      return yield* repo.resolveFullyRolledOutUpdate({
        branchId: params.branchId,
        platform: params.platform,
        runtimeVersion: params.runtimeVersion,
      });
    }

    return null;
  });

// -- Branch resolution -------------------------------------------------------

const resolveBranchId = (channel: ChannelRow, easClientId: string | undefined) => {
  const { branch_mapping_json: mapping } = channel;
  return mapping
    ? Effect.tryPromise(async () => evaluateBranchMapping(mapping, easClientId)).pipe(
        Effect.orElseSucceed(() => channel.branch_id),
      )
    : Effect.succeed(channel.branch_id);
};

// -- Response rendering (extracted to stay within max-statements) ------------

const buildUpdateResponse = (params: {
  readonly update: UpdateRow;
  readonly scopeKey: string;
  readonly ph: ProtocolHeaders;
}): Effect.Effect<Response, never, ManifestRepo> =>
  Effect.gen(function* () {
    const { update, scopeKey, ph } = params;
    const env = yield* cloudflareEnv;
    const boundary = crypto.randomUUID();
    const useMultipart = supportsMultipart(ph.accept ?? "*/*");

    if (update.is_rollback === 1) {
      if (!useMultipart) {
        return jsonError(406, "NOT_ACCEPTABLE", "Directive requires multipart/mixed");
      }
      return buildDirectiveResponse(update, ph, boundary);
    }

    if (update.manifest_body !== null) {
      const sig = signatureFor(ph, update);
      if (!useMultipart) {
        return jsonManifestResponse(update.manifest_body, sig);
      }
      return multipartResponse(boundary, [
        signedPart("manifest", update.manifest_body, sig),
        ...certChainParts(ph, update),
        extensionsPart,
      ]);
    }

    const repo = yield* ManifestRepo;
    const assetRows = yield* repo.findUpdateAssets({ updateId: update.id });
    return buildManifestFromData({
      update,
      assetRows,
      scopeKey,
      assetBaseUrl: env.ASSET_CDN_URL,
      ph,
      boundary,
      useMultipart,
    });
  });

// -- Analytics ---------------------------------------------------------------

const trackAnalytics = (params: {
  readonly env: Env;
  readonly projectId: string;
  readonly ph: ProtocolHeaders;
  readonly branchId: string;
  readonly updateId: string;
  readonly responseType: ResponseType;
  readonly resolutionMs: number;
}) => {
  params.env.ANALYTICS.writeDataPoint({
    indexes: [`${params.projectId}:${params.ph.easClientId ?? "anonymous"}`],
    blobs: [
      params.projectId,
      params.ph.channelName,
      params.branchId,
      params.updateId,
      params.ph.platform,
      params.ph.runtimeVersion,
      params.responseType,
    ],
    doubles: [params.resolutionMs, 0],
  });
};

// -- Resolution program ------------------------------------------------------

const serve = (request: Request, projectId: string): Effect.Effect<Response, never, ManifestRepo> =>
  Effect.gen(function* () {
    const startTime = Date.now();
    const env = yield* cloudflareEnv;
    const ph = yield* parseProtocolHeaders(request.headers);
    const accept = ph.accept ?? "*/*";
    if (!supportsAny(accept)) {
      return jsonError(406, "NOT_ACCEPTABLE", "Supported: multipart/mixed, application/expo+json");
    }

    const repo = yield* ManifestRepo;
    const [scopeKey, channel] = yield* Effect.all(
      [
        repo.findProjectScopeKey({ projectId }),
        repo.resolveChannel({ projectId, channelName: ph.channelName }),
      ],
      { concurrency: 2 },
    );

    if (channel.is_paused === 1) {
      trackAnalytics({
        env,
        projectId,
        ph,
        branchId: channel.branch_id,
        updateId: "",
        responseType: "no_update",
        resolutionMs: Date.now() - startTime,
      });
      return noContent();
    }

    const resolvedBranchId = yield* resolveBranchId(channel, ph.easClientId);
    const candidates = yield* repo.resolveUpdates({
      branchId: resolvedBranchId,
      platform: ph.platform,
      runtimeVersion: ph.runtimeVersion,
    });

    if (candidates.length === 0) {
      trackAnalytics({
        env,
        projectId,
        ph,
        branchId: resolvedBranchId,
        updateId: "",
        responseType: "no_update",
        resolutionMs: Date.now() - startTime,
      });
      return noContent();
    }

    // Layer 2: Per-update rollout evaluation
    const update = yield* resolveRolledOutUpdate({
      candidates,
      easClientId: ph.easClientId,
      branchId: resolvedBranchId,
      platform: ph.platform,
      runtimeVersion: ph.runtimeVersion,
    });
    if (update === null) {
      trackAnalytics({
        env,
        projectId,
        ph,
        branchId: resolvedBranchId,
        updateId: "",
        responseType: "no_update",
        resolutionMs: Date.now() - startTime,
      });
      return noContent();
    }

    const response = yield* buildUpdateResponse({ update, scopeKey, ph });
    trackAnalytics({
      env,
      projectId,
      ph,
      branchId: resolvedBranchId,
      updateId: update.id,
      responseType: update.is_rollback === 1 ? "directive" : "manifest",
      resolutionMs: Date.now() - startTime,
    });
    return response;
  }).pipe(
    // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect error handler, not a callback
    Effect.catchTag("BadRequest", (err) =>
      Effect.succeed(jsonError(400, "BAD_REQUEST", err.message)),
    ),
    // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect error handler, not a callback
    Effect.catchTag("NotFound", (err) => Effect.succeed(jsonError(404, "NOT_FOUND", err.message))),
  );

// -- Public entry point ------------------------------------------------------

export const serveManifest = async (request: Request, projectId: string): Promise<Response> =>
  Effect.runPromise(serve(request, projectId).pipe(Effect.provide(ManifestRepoLive)));
