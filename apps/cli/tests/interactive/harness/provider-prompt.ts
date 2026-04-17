#!/usr/bin/env bun
import process from "node:process";

import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Effect, Layer } from "effect";

import type * as AppleUtils from "@expo/apple-utils";

import { resolveProvider } from "../../../src/lib/apple-auth";
import { CliRuntimeLive } from "../../../src/services/cli-runtime";

// Force the prompt branch: ignore any APPLE_PROVIDER_ID from the host shell.
delete process.env["APPLE_PROVIDER_ID"];

const fakeAppleUtils = {
  Session: {
    setSessionProviderIdAsync: async (_id: number) => null,
  },
} as unknown as typeof AppleUtils;

const providers: ReadonlyArray<AppleUtils.Session.SessionProvider> = [
  {
    providerId: 10,
    publicProviderId: "pub-10",
    name: "Org Alpha",
    contentTypes: ["SOFTWARE"],
    subType: "ORGANIZATION",
  },
  {
    providerId: 20,
    publicProviderId: "pub-20",
    name: "Org Beta",
    contentTypes: ["SOFTWARE"],
    subType: "ORGANIZATION",
  },
  {
    providerId: 30,
    publicProviderId: "pub-30",
    name: "Org Gamma",
    contentTypes: ["SOFTWARE"],
    subType: "ORGANIZATION",
  },
];

const program = Effect.gen(function* () {
  const result = yield* resolveProvider(fakeAppleUtils, providers, undefined, undefined);
  // Distinctive marker so the PTY test can extract the JSON past any rendered prompt text.
  console.log(`RESULT=${JSON.stringify(result)}`);
});

program.pipe(Effect.provide(Layer.mergeAll(BunContext.layer, CliRuntimeLive)), BunRuntime.runMain);
