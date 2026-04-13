import { Command, Options } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import { Console, Effect, Option } from "effect";

import { readProjectId } from "../../lib/app-json";
import { printKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";

const platform = Options.choice("platform", ["ios", "android"]);
const type = Options.choice("type", [
  "distribution-certificate",
  "provisioning-profile",
  "push-key",
  "keystore",
  "play-service-account",
]);
const name = Options.text("name");
const file = Options.text("file");

const password = Options.text("password").pipe(Options.optional);
const distribution = Options.choice("distribution", [
  "ad-hoc",
  "app-store",
  "development",
  "enterprise",
  "play-store",
  "direct",
]).pipe(Options.optional);
const keyAlias = Options.text("key-alias").pipe(Options.optional);
const keyPassword = Options.text("key-password").pipe(Options.optional);
const projectIdOption = Options.text("project-id").pipe(Options.optional);

export const uploadCommand = Command.make(
  "upload",
  { platform, type, name, file, password, distribution, keyAlias, keyPassword, projectIdOption },
  (opts) =>
    Effect.gen(function* () {
      const resolvedProjectId = yield* Option.match(opts.projectIdOption, {
        onNone: () => readProjectId,
        onSome: (id) => Effect.succeed(id),
      });

      const fs = yield* FileSystem.FileSystem;
      const fileBytes = yield* fs.readFile(opts.file);
      const blob = Buffer.from(fileBytes).toString("base64");

      const optionalFields = {
        ...Option.match(opts.password, {
          onNone: () => ({}),
          onSome: (v) => ({ password: v }),
        }),
        ...Option.match(opts.distribution, {
          onNone: () => ({}),
          onSome: (v) => ({ distribution: v }),
        }),
        ...Option.match(opts.keyAlias, {
          onNone: () => ({}),
          onSome: (v) => ({ keyAlias: v }),
        }),
        ...Option.match(opts.keyPassword, {
          onNone: () => ({}),
          onSome: (v) => ({ keyPassword: v }),
        }),
      };

      const api = yield* apiClient;
      const credential = yield* api.credentials.upload({
        payload: {
          platform: opts.platform,
          type: opts.type,
          name: opts.name,
          blob,
          projectId: resolvedProjectId,
          ...optionalFields,
        },
      });

      yield* Console.log("Credential uploaded successfully.");
      yield* Console.log("");
      yield* printKeyValue([
        ["ID", credential.id],
        ["Name", credential.name],
        ["Platform", credential.platform],
        ["Type", credential.type],
        ["Active", credential.isActive ? "yes" : "no"],
      ]);
    }),
);
