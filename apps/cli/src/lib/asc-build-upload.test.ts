import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Effect } from "effect";

import {
  chunkRequestHeaders,
  explainBuildUploadFailure,
  formatAscErrors,
  isDeliveredFileState,
  isDuplicateBuildUploadConflict,
  parseAscErrors,
  uploadIpaViaBuildUploadApi,
} from "./asc-build-upload";
import { makeOutputModeLayer } from "./output-mode";

import type { AscUploadOperation, FetchFn } from "./asc-build-upload";
import type { UploadProgressReporter } from "./upload-progress";

const DUPLICATE_CODE = "ENTITY_ERROR.ATTRIBUTE.INVALID.DUPLICATE";

describe(parseAscErrors, () => {
  it("extracts the errors array from an ASC error body", () => {
    expect(
      parseAscErrors({
        errors: [{ status: "409", code: DUPLICATE_CODE, detail: "already uploaded" }],
      }),
    ).toStrictEqual([{ status: "409", code: DUPLICATE_CODE, detail: "already uploaded" }]);
  });

  it("returns an empty list for unparseable bodies", () => {
    expect(parseAscErrors("not json shaped")).toStrictEqual([]);
    expect(parseAscErrors(null)).toStrictEqual([]);
    expect(parseAscErrors({ data: {} })).toStrictEqual([]);
  });
});

describe(isDuplicateBuildUploadConflict, () => {
  it("matches a 409 whose every error is the duplicate code", () => {
    expect(isDuplicateBuildUploadConflict(409, [{ code: DUPLICATE_CODE }])).toBe(true);
  });

  it("rejects a 409 with mixed error codes", () => {
    expect(isDuplicateBuildUploadConflict(409, [{ code: DUPLICATE_CODE }, { code: "OTHER" }])).toBe(
      false,
    );
  });

  it("rejects other statuses and empty error lists", () => {
    expect(isDuplicateBuildUploadConflict(422, [{ code: DUPLICATE_CODE }])).toBe(false);
    expect(isDuplicateBuildUploadConflict(409, [])).toBe(false);
  });
});

describe(formatAscErrors, () => {
  it("prefers detail, then title, then code", () => {
    expect(
      formatAscErrors([{ detail: "a detail" }, { title: "a title" }, { code: "A_CODE" }]),
    ).toBe("a detail; a title; A_CODE");
  });

  it("degrades to a placeholder when there is nothing to show", () => {
    expect(formatAscErrors([])).toBe("no error detail");
  });
});

describe(explainBuildUploadFailure, () => {
  it("appends the known explanation for recognized state codes", () => {
    expect(explainBuildUploadFailure([{ code: "90725", description: "SDK version issue" }])).toBe(
      "SDK version issue (the build was made with an SDK that is too old for App Store Connect)",
    );
  });

  it("passes through unknown codes untouched", () => {
    expect(explainBuildUploadFailure([{ code: "12345", description: "mystery" }])).toBe("mystery");
  });
});

describe(chunkRequestHeaders, () => {
  it("lets Apple's operation headers override the octet-stream default", () => {
    const operation: AscUploadOperation = {
      method: "PUT",
      url: "https://storage/upload",
      offset: 0,
      length: 10,
      requestHeaders: [{ name: "Content-Type", value: "application/json" }],
    };
    expect(chunkRequestHeaders(operation)).toStrictEqual({ "content-type": "application/json" });
  });

  it("defaults Content-Type when the operation specifies none", () => {
    const operation: AscUploadOperation = {
      method: "PUT",
      url: "https://storage/upload",
      offset: 0,
      length: 10,
    };
    expect(chunkRequestHeaders(operation)).toStrictEqual({
      "content-type": "application/octet-stream",
    });
  });
});

describe(isDeliveredFileState, () => {
  it("treats COMPLETE and UPLOAD_COMPLETE as delivered", () => {
    expect(isDeliveredFileState("COMPLETE")).toBe(true);
    expect(isDeliveredFileState("UPLOAD_COMPLETE")).toBe(true);
    expect(isDeliveredFileState("AWAITING_UPLOAD")).toBe(false);
    expect(isDeliveredFileState(undefined)).toBe(false);
  });
});

// ── Full-flow tests against a scripted fetch ─────────────────────────────────

const P8_PEM = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({
  type: "pkcs8",
  format: "pem",
});

const credentials = { keyId: "KEY123", issuerId: "ISSUER-UUID", p8Pem: P8_PEM };

interface RecordedCall {
  readonly method: string;
  readonly url: string;
  readonly bodyBytes: number;
}

const makeRecordingReporter = () => {
  const events: string[] = [];
  const record = (event: string) =>
    Effect.sync(() => {
      events.push(event);
    });
  const reporter: UploadProgressReporter = {
    start: (total) => record(`start:${String(total)}`),
    advance: (delta) => record(`advance:${String(delta)}`),
    finish: () => record("finish"),
    fail: () => record("fail"),
  };
  return { events, reporter };
};

const json = (status: number, body: unknown): Response => Response.json(body, { status });

const sizeOfBody = (body: BodyInit | null | undefined): number => {
  if (typeof body === "string") {
    return body.length;
  }
  return body instanceof Uint8Array ? body.byteLength : 0;
};

/** Scripted fetch: routes JSON API calls + chunk PUTs, recording every call. */
const makeScriptedFetch = (script: {
  readonly createStatus?: number;
  readonly createBody?: unknown;
}) => {
  const calls: RecordedCall[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url, bodyBytes: sizeOfBody(init?.body) });
    if (method === "POST" && url.endsWith("/buildUploads")) {
      return json(
        script.createStatus ?? 201,
        script.createBody ?? { data: { id: "upload-1", attributes: {} } },
      );
    }
    if (method === "POST" && url.endsWith("/buildUploadFiles")) {
      return json(201, {
        data: {
          id: "file-1",
          attributes: {
            uploadOperations: [
              { method: "PUT", url: "https://storage/part1", offset: 0, length: 6 },
              { method: "PUT", url: "https://storage/part2", offset: 6, length: 6 },
            ],
          },
        },
      });
    }
    if (method === "PUT") {
      return new Response(null, { status: 200 });
    }
    if (method === "PATCH") {
      return json(200, { data: { id: "file-1", attributes: {} } });
    }
    if (url.includes("/buildUploadFiles/file-1")) {
      return json(200, {
        data: { id: "file-1", attributes: { assetDeliveryState: { state: "COMPLETE" } } },
      });
    }
    return json(200, { data: { id: "upload-1", attributes: { state: { state: "COMPLETE" } } } });
  };
  return { calls, fetchFn };
};

const withTempIpa = async (run: (ipaPath: string) => Promise<void>) => {
  const dir = await mkdtemp(path.join(tmpdir(), "asc-build-upload-test-"));
  const ipaPath = path.join(dir, "app.ipa");
  await writeFile(ipaPath, new Uint8Array(Buffer.from("abcdefghijkl")));
  try {
    await run(ipaPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const runUpload = async (ipaPath: string, fetchFn: FetchFn, reporter: UploadProgressReporter) =>
  Effect.runPromise(
    uploadIpaViaBuildUploadApi({
      credentials,
      appId: "app-1",
      ipaPath,
      shortVersion: "1.2.3",
      buildVersion: "42",
      reporter,
      fetchFn,
    }).pipe(Effect.provide(makeOutputModeLayer(true))),
  );

describe(uploadIpaViaBuildUploadApi, () => {
  it("reserves, uploads every chunk, commits, and polls to completion", async () => {
    await withTempIpa(async (ipaPath) => {
      const { calls, fetchFn } = makeScriptedFetch({});
      const { events, reporter } = makeRecordingReporter();

      const outcome = await runUpload(ipaPath, fetchFn, reporter);

      expect(outcome).toStrictEqual({ alreadyUploaded: false });
      const puts = calls.filter((call) => call.method === "PUT");
      expect(puts.map((call) => call.bodyBytes)).toStrictEqual([6, 6]);
      expect(calls.some((call) => call.method === "PATCH")).toBe(true);
      expect(events[0]).toBe("start:12");
      expect(events.filter((event) => event === "advance:6")).toHaveLength(2);
      expect(events.at(-1)).toBe("finish");
    });
  });

  it("treats the duplicate 409 at reserve as already uploaded, moving no bytes", async () => {
    await withTempIpa(async (ipaPath) => {
      const { calls, fetchFn } = makeScriptedFetch({
        createStatus: 409,
        createBody: { errors: [{ status: "409", code: DUPLICATE_CODE, detail: "dup" }] },
      });
      const { events, reporter } = makeRecordingReporter();

      const outcome = await runUpload(ipaPath, fetchFn, reporter);

      expect(outcome).toStrictEqual({ alreadyUploaded: true });
      expect(calls).toHaveLength(1);
      expect(events).toStrictEqual([]);
    });
  });

  // The _tag contract is what submit-ios-upload's catchTag fallback keys on —
  // pin it so a refactor cannot silently break the altool degradation.
  const flipUpload = async (ipaPath: string, fetchFn: FetchFn) =>
    Effect.runPromise(
      Effect.flip(
        uploadIpaViaBuildUploadApi({
          credentials,
          appId: "app-1",
          ipaPath,
          shortVersion: "1.2.3",
          buildVersion: "42",
          reporter: makeRecordingReporter().reporter,
          fetchFn,
        }).pipe(Effect.provide(makeOutputModeLayer(true))),
      ),
    );

  it.each([403, 429, 503])(
    "fails as AscBuildUploadUnavailableError (altool-fallback eligible) on a %d reserve",
    async (status) => {
      await withTempIpa(async (ipaPath) => {
        const { fetchFn } = makeScriptedFetch({
          createStatus: status,
          createBody: {
            errors: [{ status: String(status), code: "SOME_ERROR", detail: "no role" }],
          },
        });

        const error = await flipUpload(ipaPath, fetchFn);

        expect(error._tag).toBe("AscBuildUploadUnavailableError");
        expect(error.message).toMatch(/no role/);
      });
    },
  );

  it("surfaces a validation 422 at reserve as a hard AscBuildUploadError, not a fallback", async () => {
    await withTempIpa(async (ipaPath) => {
      const { fetchFn } = makeScriptedFetch({
        createStatus: 422,
        createBody: { errors: [{ status: "422", code: "ENTITY_ERROR", detail: "bad version" }] },
      });

      const error = await flipUpload(ipaPath, fetchFn);

      expect(error._tag).toBe("AscBuildUploadError");
      expect(error.message).toMatch(/bad version/);
    });
  });
});
