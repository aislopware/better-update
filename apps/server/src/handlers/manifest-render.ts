import { safeJsonParse } from "@better-update/safe-json";
import { isRecord } from "@better-update/type-guards";

import { toOptional } from "../lib/nullable";
import { buildDirective, buildExtensions, buildManifest } from "../protocol/manifest-builder";
import { encodeMultipart } from "../protocol/multipart";

import type { ProtocolHeaders } from "../protocol/headers";
import type { Part } from "../protocol/multipart";
import type { AssetRow, UpdateRow } from "../repositories/manifest";

// Pure response RENDERING for the Expo Updates manifest endpoint: it turns a
// resolved update + assets into the exact `multipart/mixed` / `application/expo+json`
// bytes the device parses. No I/O, no Effect, no repositories — handlers/manifest.ts
// owns the orchestration (which update to serve) and calls these to materialize it.
//
// Do not set `content-encoding` on manifest responses — Cloudflare edge applies
// zstd/gzip via the zone Compression Rule; manual encoding blocks it. The
// content-types here (multipart/mixed, application/expo+json) are set per-response.
const COMMON_HEADERS: Record<string, string> = {
  "expo-protocol-version": "1",
  "expo-sfv-version": "0",
  "cache-control": "private, max-age=0",
};

const protocolResponse = (body: string | null, status: number, headers?: Record<string, string>) =>
  new Response(body, { status, headers: { ...COMMON_HEADERS, ...headers } });

export const jsonError = (status: number, code: string, message: string) =>
  protocolResponse(JSON.stringify({ code, message }), status, {
    "content-type": "application/json",
  });
export const noContent = () => protocolResponse(null, 204);
export const multipartResponse = (boundary: string, parts: readonly Part[]) =>
  protocolResponse(encodeMultipart(boundary, parts), 200, {
    "content-type": `multipart/mixed; boundary=${boundary}`,
  });
export const jsonManifestResponse = (manifestJson: string, signature: string | undefined) =>
  protocolResponse(manifestJson, 200, {
    "content-type": "application/expo+json",
    ...(signature ? { "expo-signature": signature } : {}),
  });

export const supportsMultipart = (accept: string) =>
  accept.includes("multipart/mixed") || accept.includes("*/*");
export const supportsAny = (accept: string) =>
  supportsMultipart(accept) ||
  accept.includes("application/expo+json") ||
  accept.includes("application/json");

export const signedPart = (name: string, body: string, signature: string | undefined): Part => ({
  name,
  contentType: "application/json",
  ...(signature ? { headers: { "expo-signature": signature } } : {}),
  body,
});

export const extensionsPart: Part = {
  name: "extensions",
  contentType: "application/json",
  body: JSON.stringify(buildExtensions()),
};

export const signatureFor = (ph: ProtocolHeaders, update: UpdateRow) =>
  ph.expectSignature ? toOptional(update.signature) : undefined;
export const certChainParts = (ph: ProtocolHeaders, update: UpdateRow): readonly Part[] =>
  ph.expectSignature && update.certificate_chain
    ? [
        {
          name: "certificate_chain",
          contentType: "application/x-pem-file",
          body: update.certificate_chain,
        },
      ]
    : [];

export const parseJson = (raw: string): Record<string, unknown> => {
  const parsed = safeJsonParse(raw);
  return isRecord(parsed) ? parsed : {};
};

export const buildDirectiveResponse = (
  update: UpdateRow,
  ph: ProtocolHeaders,
  boundary: string,
) => {
  // Serve a stored directive_body BYTE-FOR-BYTE — those are the exact bytes a
  // code-signed directive was signed over, so a parse→stringify round-trip would
  // re-canonicalize the JSON and break signature byte-identity (the device would
  // verify the signature against different bytes and reject the directive). Only
  // the server-generated fallback (directive_body === null, always unsigned) is
  // rendered fresh.
  const storedBody = update.directive_body;
  const directiveBody =
    storedBody ??
    JSON.stringify(
      buildDirective({
        update: {
          id: update.id,
          createdAt: update.created_at,
          runtimeVersion: update.runtime_version,
          metadata: {},
          extra: undefined,
        },
      }),
    );

  // A signature only ever covers the STORED bytes. A freshly-rendered fallback
  // directive (storedBody === null) is always unsigned — never attach a stored
  // signature to bytes it was not computed over (that would be a guaranteed
  // signature mismatch on-device).
  const signature = storedBody === null ? undefined : signatureFor(ph, update);

  return multipartResponse(boundary, [
    signedPart("directive", directiveBody, signature),
    ...certChainParts(ph, update),
    extensionsPart,
  ]);
};

export const buildManifestFromData = (params: {
  readonly update: UpdateRow;
  readonly assetRows: readonly AssetRow[];
  readonly assetBaseUrl: string;
  readonly serverBaseUrl: string;
  readonly projectId: string;
  readonly ph: ProtocolHeaders;
  readonly boundary: string;
  readonly useMultipart: boolean;
}) => {
  const { update, assetRows, assetBaseUrl, serverBaseUrl, projectId, ph, boundary, useMultipart } =
    params;
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
        contentChecksum: row.content_checksum,
        contentType: row.content_type,
        fileExt: row.file_ext,
        isLaunch: row.is_launch === 1,
      })),
      assetBaseUrl,
      // Launch asset URL points at the Worker bundle route so the Worker can
      // negotiate bsdiff patches (see protocol/manifest-builder.ts).
      serverBaseUrl,
      projectId,
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
