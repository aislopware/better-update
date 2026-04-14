import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { toBase64Url } from "./base64";

export interface Sha256StreamDigest {
  readonly sha256Hex: string;
  readonly sha256Base64Url: string;
  readonly byteSize: number;
}

export interface TeeSha256DigestResult {
  readonly uploadBody: ReadableStream<Uint8Array>;
  readonly digest: Promise<Sha256StreamDigest>;
}

const emptyStream = () =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });

const readNextChunk = async (params: {
  readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  readonly hasher: ReturnType<typeof sha256.create>;
  readonly byteSize: number;
}): Promise<number> => {
  const { done, value } = await params.reader.read();
  if (done) {
    return params.byteSize;
  }

  params.hasher.update(value);
  return readNextChunk({
    reader: params.reader,
    hasher: params.hasher,
    byteSize: params.byteSize + value.byteLength,
  });
};

const digestStream = async (body: ReadableStream<Uint8Array>): Promise<Sha256StreamDigest> => {
  const reader = body.getReader();
  const hasher = sha256.create();
  const byteSize = await readNextChunk({
    reader,
    hasher,
    byteSize: 0,
  });
  reader.releaseLock();

  const digestBytes = hasher.digest();
  return {
    sha256Hex: bytesToHex(digestBytes),
    sha256Base64Url: toBase64Url(digestBytes),
    byteSize,
  };
};

/**
 * Duplicate a readable body so one branch can stream into storage while the
 * other computes SHA-256 and byte size without buffering the whole payload.
 */
export const teeBodyWithSha256 = (
  body: ReadableStream<Uint8Array> | null | undefined,
): TeeSha256DigestResult => {
  const source = body ?? emptyStream();
  const [uploadBody, digestBody] = source.tee();

  return {
    uploadBody,
    digest: digestStream(digestBody),
  };
};
