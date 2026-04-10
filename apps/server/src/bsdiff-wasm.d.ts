declare module "@better-update/bsdiff-wasm" {
  export function diff(oldData: Uint8Array, newData: Uint8Array): Uint8Array;
  export function patch(oldData: Uint8Array, patchData: Uint8Array): Uint8Array;
}
