import { parseDotenvContent, parseDotenvEntries } from "./dotenv";

describe(parseDotenvEntries, () => {
  it("parses basic key-value entries and skips comments", () => {
    expect(
      parseDotenvEntries(`
# comment
FOO=bar
EMPTY=
INVALID
`),
    ).toStrictEqual([
      { key: "FOO", value: "bar" },
      { key: "EMPTY", value: "" },
    ]);
  });

  it("supports export prefixes, quoted values, and inline comments", () => {
    expect(
      parseDotenvEntries(`
export API_URL=https://example.com # public URL
SECRET_HASH="value#kept"
SINGLE='also#kept'
MULTILINE="one\\ntwo"
`),
    ).toStrictEqual([
      { key: "API_URL", value: "https://example.com" },
      { key: "SECRET_HASH", value: "value#kept" },
      { key: "SINGLE", value: "also#kept" },
      { key: "MULTILINE", value: "one\ntwo" },
    ]);
  });

  it("keeps hash characters in unquoted values when they are not comment-delimited", () => {
    expect(parseDotenvEntries("TOKEN=abc#123")).toStrictEqual([{ key: "TOKEN", value: "abc#123" }]);
  });
});

describe(parseDotenvContent, () => {
  it("uses the last value for duplicate keys", () => {
    expect(parseDotenvContent("FOO=1\nFOO=2")).toStrictEqual({ FOO: "2" });
  });
});
