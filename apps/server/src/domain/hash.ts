/**
 * SHA-256 based deterministic hash-to-fraction.
 * Returns a value in [0, 1) for the given salt:clientId pair.
 */
export const hashToFraction = async (salt: string, clientId: string): Promise<number> => {
  const input = new TextEncoder().encode(`${salt}:${clientId}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", input);
  const view = new DataView(hashBuffer);
  return view.getUint32(0, false) / 4_294_967_296;
};
