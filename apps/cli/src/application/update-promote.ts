import { BadRequest, Conflict, Forbidden, NotFound } from "@better-update/api";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import { AuthRequiredError, UpdatePromoteError } from "../lib/exit-codes";
import { loadOptionalSignedPayload } from "../lib/signed-payloads";
import { apiClient, type ApiClientService } from "../services/api-client";

export interface RunUpdatePromoteOptions {
  readonly updateId: string;
  readonly channel: string;
  readonly manifestBodyFile: string | undefined;
  readonly signatureFile: string | undefined;
  readonly certificateChainFile: string | undefined;
}

export interface UpdatePromoteResult {
  readonly sourceUpdateId: string;
  readonly channel: string;
  readonly updateId: string;
}

export const runUpdatePromote = (
  options: RunUpdatePromoteOptions,
): Effect.Effect<
  UpdatePromoteResult,
  AuthRequiredError | UpdatePromoteError | BadRequest | NotFound | Conflict | Forbidden,
  ApiClientService | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const signedPayload = yield* loadOptionalSignedPayload({
      files: {
        manifestBodyFile: options.manifestBodyFile,
        signatureFile: options.signatureFile,
        certificateChainFile: options.certificateChainFile,
      },
      label: "Signed promote",
      makeError: (message) => new UpdatePromoteError({ message }),
    });

    const result = yield* api.updates.republish({
      payload: {
        sourceUpdateId: options.updateId,
        destinationChannel: options.channel,
        ...(signedPayload
          ? {
              signedUpdates: [
                {
                  sourceUpdateId: options.updateId,
                  manifestBody: signedPayload.manifestBody,
                  signature: signedPayload.signature,
                  certificateChain: signedPayload.certificateChain,
                },
              ],
            }
          : {}),
      },
    });

    const [promotedUpdate] = result.updates;
    if (!promotedUpdate) {
      return yield* new UpdatePromoteError({
        message: "Promote completed without returning a promoted update.",
      });
    }

    return {
      sourceUpdateId: options.updateId,
      channel: options.channel,
      updateId: promotedUpdate.id,
    } as const satisfies UpdatePromoteResult;
  });
