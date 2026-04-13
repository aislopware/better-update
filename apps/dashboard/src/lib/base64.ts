export const toBase64 = (bytes: Uint8Array): string => {
  const binary = [...bytes].map((byte) => String.fromCodePoint(byte)).join("");
  return btoa(binary);
};
