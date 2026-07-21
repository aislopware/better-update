/** Shared `tag → exit code` extras for the `macos` command group. */
export const MACOS_EXIT_EXTRAS = {
  MissingCredentialsError: 5,
  CredentialValidationError: 2,
  KeychainError: 6,
  CodesignError: 6,
  NotarizationError: 6,
} as const;
