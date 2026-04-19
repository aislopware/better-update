// eslint-disable-next-line eslint-js/no-restricted-syntax -- boundary helper; raw `?? null` is banned elsewhere
export const toDbNull = <T>(value: T | null | undefined): T | null => value ?? null;

// eslint-disable-next-line eslint-js/no-restricted-syntax -- boundary helper; raw `?? undefined` is banned elsewhere
export const toOptional = <T>(value: T | null | undefined): T | undefined => value ?? undefined;
