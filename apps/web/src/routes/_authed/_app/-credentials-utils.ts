import type { AppleTeamItem } from "@better-update/api-client/react";

export const formatAppleTeamLabel = (team: {
  readonly name: string | null;
  readonly appleTeamId: string;
}) => (team.name === null ? team.appleTeamId : `${team.name} (${team.appleTeamId})`);

const APPLE_TEAM_TYPE_LABEL: Record<AppleTeamItem["appleTeamType"], string> = {
  IN_HOUSE: "In-House",
  COMPANY_ORGANIZATION: "Company/Organization",
  INDIVIDUAL: "Individual",
};

export const formatAppleTeamType = (type: AppleTeamItem["appleTeamType"]): string =>
  APPLE_TEAM_TYPE_LABEL[type];

// Apple credentials carry the internal team row UUID (`appleTeamId`); index the
// org's teams by that id so credential tables can resolve a human-readable team.
export const indexAppleTeamsById = (
  teams: readonly AppleTeamItem[],
): ReadonlyMap<string, AppleTeamItem> => new Map(teams.map((team) => [team.id, team]));

export const isoToDate = (iso: string): Date | undefined => (iso ? new Date(iso) : undefined);

// Snap a calendar date to the UTC start/end of that day so credential validity
// boundaries round-trip without drifting across the viewer's local timezone.
export const dateToIsoBoundary = (date: Date | undefined, boundary: "start" | "end"): string => {
  if (!date) {
    return "";
  }
  const utc =
    boundary === "start"
      ? Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
      : Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 0);
  return new Date(utc).toISOString();
};
