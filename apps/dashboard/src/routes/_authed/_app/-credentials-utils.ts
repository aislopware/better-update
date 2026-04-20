import { toBase64 } from "@better-update/encoding";
import { Effect } from "effect";

const readBase64 = async (file: File): Promise<string> =>
  toBase64(new Uint8Array(await file.arrayBuffer()));

export const safeReadFileAsBase64 = async (file: File): Promise<string | null> =>
  Effect.runPromise(
    Effect.catchAll(
      Effect.tryPromise(async () => readBase64(file)),
      () => Effect.succeed<string | null>(null),
    ),
  );

export const safeReadFileAsText = async (file: File): Promise<string | null> =>
  Effect.runPromise(
    Effect.catchAll(
      Effect.tryPromise(async () => file.text()),
      () => Effect.succeed<string | null>(null),
    ),
  );

export const formatAppleTeamLabel = (team: {
  readonly name: string | null;
  readonly appleTeamId: string;
}) => (team.name === null ? team.appleTeamId : `${team.name} (${team.appleTeamId})`);
