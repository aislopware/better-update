import { toBase64 } from "@better-update/encoding";

const readBase64 = async (file: File): Promise<string> =>
  toBase64(new Uint8Array(await file.arrayBuffer()));

export const safeReadFileAsBase64 = async (file: File): Promise<string | null> => {
  // eslint-disable-next-line functional/no-try-statements -- browser file reads reject on permission/IO errors; upload forms represent that as null
  try {
    return await readBase64(file);
  } catch {
    return null;
  }
};

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
