/**
 * Minimal but well-formed desktop packages for tests: a `.deb` (ar + control
 * tar), an `.rpm` (lead + signature + main header), an ELF header (an
 * AppImage's runtime) and electron-builder's appended AppImage blockmap.
 */
import { deflateRawSync, gzipSync } from "node:zlib";

export const ascii = (text: string) => new TextEncoder().encode(text);

export const concat = (...parts: readonly Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  parts.reduce((offset, part) => {
    out.set(part, offset);
    return offset + part.length;
  }, 0);
  return out;
};

const padded = (text: string, width: number) => ascii(text.padEnd(width, " "));

/** A ustar archive of the given files. */
export const tar = (files: Readonly<Record<string, string>>) =>
  concat(
    ...Object.entries(files).flatMap(([name, content]) => {
      const header = new Uint8Array(512);
      header.set(ascii(name), 0);
      header.set(ascii(`${content.length.toString(8).padStart(11, "0")}\0`), 124);
      const body = new Uint8Array(Math.ceil(content.length / 512) * 512);
      body.set(ascii(content));
      return [header, body];
    }),
    new Uint8Array(1024),
  );

/** An `ar` archive, as `dpkg-deb` writes a `.deb`. */
export const ar = (members: Readonly<Record<string, Uint8Array>>) =>
  concat(
    ascii("!<arch>\n"),
    ...Object.entries(members).flatMap(([name, data]) => [
      padded(`${name}/`, 16),
      padded("0", 12),
      padded("0", 6),
      padded("0", 6),
      padded("100644", 8),
      padded(String(data.length), 10),
      ascii("`\n"),
      data,
      data.length % 2 === 1 ? ascii("\n") : new Uint8Array(0),
    ]),
  );

export const CONTROL =
  "Package: example-app\nVersion: 1:2.4.0\nArchitecture: arm64\nDescription: An app\n  continued line\n";

export const deb = (controlMember: string, data: Uint8Array) =>
  ar({ "debian-binary": ascii("2.0\n"), [controlMember]: data, "data.tar.gz": gzipSync(tar({})) });

export const u32 = (value: number) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
};

/** One RPM header structure holding string tags. */
const rpmHeaderBytes = (tags: Readonly<Record<number, string>>) => {
  const entries = Object.entries(tags);
  const store = entries.reduce<{ offsets: number[]; data: Uint8Array }>(
    (acc, [, value]) => ({
      offsets: [...acc.offsets, acc.data.length],
      data: concat(acc.data, ascii(`${value}\0`)),
    }),
    { offsets: [], data: new Uint8Array(0) },
  );
  return concat(
    new Uint8Array([0x8e, 0xad, 0xe8, 0x01, 0, 0, 0, 0]),
    u32(entries.length),
    u32(store.data.length),
    ...entries.flatMap(([tag], index) => [
      u32(Number(tag)),
      u32(6),
      u32(store.offsets[index] ?? 0),
      u32(1),
    ]),
    store.data,
  );
};

export const rpm = (tags: Readonly<Record<number, string>>) => {
  const lead = new Uint8Array(96);
  lead.set([0xed, 0xab, 0xee, 0xdb]);
  // A 3-byte store makes the signature header end off an 8-byte boundary.
  const signature = rpmHeaderBytes({ 1000: "ab" });
  const padding = new Uint8Array((8 - (signature.length % 8)) % 8);
  return concat(lead, signature, padding, rpmHeaderBytes(tags), ascii("payload"));
};

export const elf = (machine: number) => {
  const bytes = new Uint8Array(64);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
  new DataView(bytes.buffer).setUint16(18, machine, true);
  return bytes;
};

export const withBlockmap = (body: Uint8Array) => {
  const blockmap = deflateRawSync(
    JSON.stringify({
      version: "2",
      files: [{ name: "file", offset: 0, checksums: [], sizes: [] }],
    }),
  );
  return { bytes: concat(body, blockmap, u32(blockmap.length)), size: blockmap.length };
};
