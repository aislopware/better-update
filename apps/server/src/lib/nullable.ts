// eslint-disable-next-line eslint-js/no-restricted-syntax -- boundary helper; raw `?? null` is banned elsewhere
export const toDbNull = <T>(value: T | null | undefined): T | null => value ?? null;

export { toOptional } from "@better-update/type-guards";
