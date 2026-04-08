import { encodeMultipart } from "./multipart";

import type { Part } from "./multipart";

const makePart = (overrides?: Partial<Part>): Part => ({
  name: "manifest",
  contentType: "application/json",
  body: '{"id":"123"}',
  ...overrides,
});

describe(encodeMultipart, () => {
  test("encodes 2 parts with correct boundary markers and CRLF", () => {
    const parts: readonly Part[] = [
      makePart({ name: "manifest", body: '{"id":"1"}' }),
      makePart({ name: "extensions", contentType: "application/json", body: '{"extra":true}' }),
    ];

    const result = encodeMultipart("boundary123", parts);

    expect(result).toContain("--boundary123\r\n");
    expect(result).toContain("--boundary123--\r\n");
    expect(result).toContain('{"id":"1"}');
    expect(result).toContain('{"extra":true}');
  });

  test("extra headers on parts are included", () => {
    const parts: readonly Part[] = [
      makePart({ headers: { "expo-signature": "sig-abc", "x-custom": "val" } }),
    ];

    const result = encodeMultipart("b", parts);

    expect(result).toContain("expo-signature: sig-abc\r\n");
    expect(result).toContain("x-custom: val\r\n");
  });

  test("parts have correct content-disposition with name", () => {
    const parts: readonly Part[] = [makePart({ name: "directive" })];

    const result = encodeMultipart("b", parts);

    expect(result).toContain('content-disposition: inline; name="directive"');
  });

  test("headers and body separated by blank CRLF line", () => {
    const parts: readonly Part[] = [makePart({ body: "BODY_CONTENT" })];

    const result = encodeMultipart("sep", parts);

    // Blank CRLF separates headers from body
    expect(result).toContain("\r\n\r\nBODY_CONTENT");
  });
});
