import type {
  AndroidUploadKeystore,
  AppleDistributionCertificate,
  ApplePushKey,
  AppleTeam,
} from "@better-update/api";

/** A `promptSelect` option enriched with a secondary `hint` line. */
export interface CredentialChoice {
  readonly value: string;
  readonly label: string;
  readonly hint?: string;
}

/** ISO timestamp → `YYYY-MM-DD` for compact, scannable labels. */
const isoDate = (value: string): string => value.slice(0, 10);

/**
 * Credentials store the internal team UUID, which is meaningless to read. Build a
 * resolver from `appleTeams.list()` that maps it to the team name (falling back to
 * the 10-char portal identifier, then the raw id if the team isn't in the list).
 */
export const makeAppleTeamLabeler = (
  teams: readonly AppleTeam[],
): ((internalTeamId: string) => string) => {
  const byId = new Map(teams.map((team) => [team.id, team.name ?? team.appleTeamId] as const));
  return (internalTeamId) => byId.get(internalTeamId) ?? internalTeamId;
};

/**
 * Keystore aliases are often cryptic, so surface the type + creation date in the
 * label and the SHA-1 fingerprint (which matches the Play Console upload key) on
 * the active-row hint.
 */
export const keystoreChoice = (item: AndroidUploadKeystore): CredentialChoice => {
  const details = [item.keystoreType, `created ${isoDate(item.createdAt)}`].filter(
    (part): part is string => part !== null,
  );
  return {
    value: item.id,
    label: `${item.keyAlias} (${details.join(", ")})`,
    hint: item.sha1Fingerprint ? `SHA-1 ${item.sha1Fingerprint}` : `id ${item.id.slice(0, 8)}…`,
  };
};

/**
 * Push keys share a team, so include the creation date to tell siblings apart.
 * Pass a `teamLabel` (see {@link makeAppleTeamLabeler}) to show the team name
 * instead of the internal UUID.
 */
export const pushKeyChoice = (
  key: ApplePushKey,
  teamLabel: string = key.appleTeamId,
): CredentialChoice => ({
  value: key.id,
  label: `${key.keyId} (team ${teamLabel}, added ${isoDate(key.createdAt)})`,
});

/**
 * Surface the expiry so an expired certificate is obvious before it's picked.
 * Pass a `teamLabel` (see {@link makeAppleTeamLabeler}) to show the team name
 * instead of the internal UUID.
 */
export const distributionCertChoice = (
  cert: AppleDistributionCertificate,
  teamLabel: string = cert.appleTeamId,
): CredentialChoice => ({
  value: cert.id,
  label: `${cert.serialNumber.slice(0, 12)}… (team ${teamLabel}, exp ${isoDate(cert.validUntil)})`,
});
