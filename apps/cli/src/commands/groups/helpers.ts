// Exit-code map for the `groups` command family (the `exits` option of the
// command-exit wrapper). Unlike `policies`, group commands take no JSON document
// to parse, so they raise no command-specific error — the entry just reserves the
// exit code for symmetry; API errors (NotFound/Conflict/Forbidden) are mapped by
// the shared runApi machinery.
export const groupErrorExtras = { GroupCommandError: 2 } as const;
