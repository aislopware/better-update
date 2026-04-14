import { createHash } from "node:crypto";

import { teeBodyWithSha256 } from "./stream-digest";

const streamFromChunks = (...chunks: readonly string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });

describe(teeBodyWithSha256, () => {
  test("computes sha256 and byte size while preserving the upload stream", async () => {
    const body = streamFromChunks("hello ", "world");
    const { uploadBody, digest } = teeBodyWithSha256(body);

    const [copiedText, digestResult] = await Promise.all([new Response(uploadBody).text(), digest]);

    expect(copiedText).toBe("hello world");
    expect(digestResult.byteSize).toBe(11);
    expect(digestResult.sha256Hex).toBe(createHash("sha256").update("hello world").digest("hex"));
    expect(digestResult.sha256Base64Url).toBe(
      createHash("sha256").update("hello world").digest("base64url"),
    );
  });

  test("handles empty bodies without buffering", async () => {
    const { uploadBody, digest } = teeBodyWithSha256(null);
    const [copiedText, digestResult] = await Promise.all([new Response(uploadBody).text(), digest]);

    expect(copiedText).toBe("");
    expect(digestResult.byteSize).toBe(0);
    expect(digestResult.sha256Hex).toBe(createHash("sha256").update("").digest("hex"));
  });
});
