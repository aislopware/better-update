import path from "node:path";

import { Command, Options } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import { Console, Effect, Option } from "effect";

import { generateAndroidKeystore, promptAndroidKeystoreDetails } from "../../lib/android-keystore";
import { readProjectId } from "../../lib/app-json";
import { uploadAndActivateCredential } from "../../lib/credentials-manager";
import { printKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";

const name = Options.text("name").pipe(Options.optional);
const keyAlias = Options.text("key-alias").pipe(Options.optional);
const password = Options.text("password").pipe(Options.optional);
const keyPassword = Options.text("key-password").pipe(Options.optional);
const commonName = Options.text("common-name").pipe(Options.optional);
const organization = Options.text("organization").pipe(Options.optional);
const output = Options.text("output").pipe(Options.optional);
const projectIdOption = Options.text("project-id").pipe(Options.optional);

export const generateKeystoreCommand = Command.make(
  "generate-keystore",
  { name, keyAlias, password, keyPassword, commonName, organization, output, projectIdOption },
  (opts) =>
    Effect.scoped(
      Effect.gen(function* () {
        const projectId = yield* Option.match(opts.projectIdOption, {
          onNone: () => readProjectId,
          onSome: (id) => Effect.succeed(id),
        });

        const details = yield* promptAndroidKeystoreDetails({
          ...Option.match(opts.name, {
            onNone: () => ({}),
            onSome: (value) => ({ credentialName: value }),
          }),
          ...Option.match(opts.keyAlias, {
            onNone: () => ({}),
            onSome: (value) => ({ keyAlias: value }),
          }),
          ...Option.match(opts.password, {
            onNone: () => ({}),
            onSome: (value) => ({ storePassword: value }),
          }),
          ...Option.match(opts.keyPassword, {
            onNone: () => ({}),
            onSome: (value) => ({ keyPassword: value }),
          }),
          ...Option.match(opts.commonName, {
            onNone: () => ({}),
            onSome: (value) => ({ commonName: value }),
          }),
          ...Option.match(opts.organization, {
            onNone: () => ({}),
            onSome: (value) => ({ organization: value }),
          }),
        });

        const fs = yield* FileSystem.FileSystem;
        const outputPath = yield* Option.match(opts.output, {
          onNone: () =>
            fs
              .makeTempDirectoryScoped({ prefix: "better-update-keystore-" })
              .pipe(Effect.map((tempDir) => path.join(tempDir, "release.keystore"))),
          onSome: (value) => {
            const resolved = path.resolve(value);
            return fs
              .makeDirectory(path.dirname(resolved), { recursive: true })
              .pipe(Effect.as(resolved));
          },
        });

        yield* generateAndroidKeystore({
          outputPath,
          keyAlias: details.keyAlias,
          storePassword: details.storePassword,
          keyPassword: details.keyPassword,
          commonName: details.commonName,
          organization: details.organization,
        });

        const api = yield* apiClient;
        const credential = yield* uploadAndActivateCredential(api, {
          projectId,
          platform: "android",
          type: "keystore",
          name: details.credentialName,
          filePath: outputPath,
          password: details.storePassword,
          keyAlias: details.keyAlias,
          keyPassword: details.keyPassword,
        });

        yield* Console.log("Android keystore generated, uploaded, and activated.");
        yield* Console.log("");
        yield* printKeyValue([
          ["ID", credential.id],
          ["Name", credential.name],
          ["Alias", details.keyAlias],
          ["Path", outputPath],
        ]);
      }),
    ),
);
