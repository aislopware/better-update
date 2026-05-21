export const safeReadFileAsText = async (file: File): Promise<string | null> => {
  // eslint-disable-next-line functional/no-try-statements -- browser file reads reject on permission/IO errors; upload forms represent that as null
  try {
    return await file.text();
  } catch {
    return null;
  }
};

export const formatAppleTeamLabel = (team: {
  readonly name: string | null;
  readonly appleTeamId: string;
}) => (team.name === null ? team.appleTeamId : `${team.name} (${team.appleTeamId})`);

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
