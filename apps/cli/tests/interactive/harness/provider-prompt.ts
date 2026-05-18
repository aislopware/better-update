#!/usr/bin/env node
import process from "node:process";

import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";

import type { Session } from "@expo/apple-utils";
// eslint-disable-next-line import-plugin/no-namespace -- harness casts a stub as `typeof AppleUtils` (whole module shape) to satisfy resolveProvider's injected module param
import type * as AppleUtils from "@expo/apple-utils";

import { resolveProvider } from "../../../src/lib/apple-auth";
import { InteractiveModeLive } from "../../../src/lib/interactive-mode";
import { CliRuntimeLive } from "../../../src/services/cli-runtime";

// Force the prompt branch: ignore any APPLE_PROVIDER_ID from the host shell.
delete process.env["APPLE_PROVIDER_ID"];

const fakeAppleUtils = {
  Session: {
    setSessionProviderIdAsync: async (_id: number) => null,
  },
} as unknown as typeof AppleUtils;

const providers: readonly Session.SessionProvider[] = [
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
  const result = yield* resolveProvider(fakeAppleUtils, providers, undefined);
  // Distinctive marker so the PTY test can extract the JSON past any rendered prompt text.
  // eslint-disable-next-line eslint/no-console -- interactive PTY harness prints a parseable marker to stdout; Effect.Console adds formatting that breaks the parser
  console.log(`RESULT=${JSON.stringify(result)}`);
});

program.pipe(
  Effect.provide(Layer.mergeAll(NodeContext.layer, CliRuntimeLive, InteractiveModeLive)),
  NodeRuntime.runMain,
);
