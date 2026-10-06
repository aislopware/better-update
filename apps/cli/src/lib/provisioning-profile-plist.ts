/**
 * The property list inside a provisioning profile. A profile is a CMS (PKCS #7)
 * envelope whose content is an XML plist, stored as-is, so it is read straight
 * out of the bytes. `security cms -D` would decode it too, but imports the
 * signer's certificates into the default keychain first and fails where there
 * is none — a CI user, a launchd job, an isolated `HOME`.
 */
const PLIST_START = "<?xml";
const PLIST_END = "</plist>";

/** The profile's plist XML, or `undefined` when the bytes hold none. */
export const profilePlistXml = (bytes: Uint8Array): string | undefined => {
  // A single-byte decoding keeps string offsets equal to byte offsets.
  const text = new TextDecoder("latin1").decode(bytes);
  const start = text.indexOf(PLIST_START);
  const end = start === -1 ? -1 : text.indexOf(PLIST_END, start);
  // The plist itself is UTF-8: a profile name need not be ASCII.
  return end === -1
    ? undefined
    : new TextDecoder().decode(bytes.subarray(start, end + PLIST_END.length));
};
