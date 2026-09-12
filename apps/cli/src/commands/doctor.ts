import { spawnSync } from "node:child_process";

import { Data, Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { asProjectType, detectProjectType } from "../lib/detect-project-type";
import {
  BETTER_UPDATE_PROJECT_ID_ENV,
  listBuildProfileNames,
  readEasLinkedProjectId,
  readEasProjectType,
} from "../lib/eas-json";
import { printHumanTable } from "../lib/output";
import { readProjectId } from "../lib/project-link";
import { runCommand } from "../lib/run-command";
import { apiClient } from "../services/api-client";
import { loadBsdiffBinding } from "../services/bsdiff";
import { CliRuntime } from "../services/cli-runtime";
import { ConfigStore } from "../services/config-store";

class HealthCheckError extends Data.TaggedError("HealthCheckError")<{
  message: string;
  cause?: unknown;
}> {}

type CheckStatus = "pass" | "warn" | "fail";

interface CheckResult {
  readonly id: string;
  readonly name: string;
  readonly status: CheckStatus;
  readonly message: string;
}

const pass = (id: string, name: string, message: string): CheckResult => ({
  id,
  name,
  status: "pass",
  message,
});

const warn = (id: string, name: string, message: string): CheckResult => ({
  id,
  name,
  status: "warn",
  message,
});

const fail = (id: string, name: string, message: string): CheckResult => ({
  id,
  name,
  status: "fail",
  message,
});

// The CLI itself is a standalone binary and needs no Node; the HOST Node is
// what Expo / Metro / prebuild run on, so it is probed like any other tool.
const checkNode = Effect.sync((): CheckResult => {
  const result = spawnSync("node", ["--version"], { stdio: "pipe", timeout: 5000 });
  if (result.status !== 0) {
    return warn("node", "Node.js version", "node not found on PATH (required for Expo builds)");
  }
  const version = result.stdout.toString().trim().replace(/^v/u, "");
  const major = Number.parseInt(version.split(".")[0] ?? "0", 10);
  if (major >= 22) {
    return pass("node", "Node.js version", `${version} (>= 22 required)`);
  }
  return fail("node", "Node.js version", `${version} is below the minimum required version 22`);
});

// The bsdiff native addon is embedded in the binary; a build for a platform it
// was not compiled for silently loses OTA patch precompute, so surface it here.
const checkBsdiff = Effect.match(loadBsdiffBinding, {
  onSuccess: () => pass("bsdiff", "bsdiff native addon", "loaded (OTA patches enabled)"),
  onFailure: (error) => fail("bsdiff", "bsdiff native addon", error.message),
});

const checkCommand = (id: string, name: string, command: string, args: readonly string[]) =>
  Effect.sync((): CheckResult => {
    const result = spawnSync(command, [...args], { stdio: "pipe", timeout: 5000 });
    if (result.status === 0) {
      const stdout = result.stdout.toString().trim();
      return pass(id, name, stdout.length > 0 ? stdout : "available");
    }
    return warn(id, name, `${command} not found or returned status ${result.status}`);
  });

const checkServerHealth = Effect.gen(function* () {
  const config = yield* ConfigStore;
  const base = yield* config.getBaseUrl;
  const url = `${base}/api/health`;
  const response = yield* Effect.tryPromise({
    try: async () => fetch(url, { signal: AbortSignal.timeout(3000) }),
    catch: (cause) => new HealthCheckError({ message: String(cause), cause }),
  }).pipe(Effect.result);
  if (response._tag === "Failure") {
    return fail("health", "Server reachable", `${url} unreachable: ${response.failure.message}`);
  }
  const res = response.success;
  if (res.ok) {
    return pass("health", "Server reachable", `${url} returned 200`);
  }
  return warn("health", "Server reachable", `${url} returned ${res.status}`);
}).pipe(Effect.scoped);

const checkAuth = Effect.gen(function* () {
  const api = yield* apiClient.pipe(Effect.option);
  if (api._tag === "None") {
    return fail("auth", "Auth token", "Not logged in (run `better-update login`)");
  }
  const result = yield* api.value.me.get().pipe(Effect.result);
  if (result._tag === "Failure") {
    return fail("auth", "Auth token", `Token rejected by server: ${String(result.failure)}`);
  }
  const me = result.success;
  const who = me.user?.email ?? me.actorEmail;
  return pass("auth", "Auth token", `Valid (${who})`);
});

const checkProjectLink = Effect.gen(function* () {
  const runtime = yield* CliRuntime;
  const root = yield* runtime.cwd;
  const fromEnv = yield* runtime.getEnv(BETTER_UPDATE_PROJECT_ID_ENV);
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return pass(
      "project-linked",
      "Project linked",
      `projectId=${fromEnv} (via ${BETTER_UPDATE_PROJECT_ID_ENV})`,
    );
  }
  const resolved = yield* readProjectId.pipe(Effect.result);
  if (resolved._tag === "Failure") {
    return warn("project-linked", "Project linked", resolved.failure.message);
  }
  // Distinguish the eas.json link from the Expo-config fallback.
  const fromFile = yield* readEasLinkedProjectId(root);
  const source = fromFile === undefined ? "Expo config" : "eas.json";
  return pass("project-linked", "Project linked", `projectId=${resolved.success} (via ${source})`);
});

const checkProjectType = Effect.gen(function* () {
  const runtime = yield* CliRuntime;
  const root = yield* runtime.cwd;
  const override = asProjectType(yield* readEasProjectType(root));
  const type = yield* detectProjectType({ projectRoot: root, override });
  const via = override === undefined ? "auto-detected" : "eas.json override";
  return pass("project-type", "Project type", `${type} (${via})`);
});

const checkBuildConfig = Effect.gen(function* () {
  const runtime = yield* CliRuntime;
  const root = yield* runtime.cwd;
  const names = yield* listBuildProfileNames(root).pipe(Effect.result);
  if (names._tag === "Failure") {
    return warn("build-config", "Build config", names.failure.message);
  }
  if (names.success.length === 0) {
    return warn(
      "build-config",
      "Build config",
      'No build profiles found. Add a "build" section to eas.json.',
    );
  }
  return pass("build-config", "Build config", `${names.success.length} profile(s) defined`);
});

const runChecks = Effect.gen(function* () {
  const runtime = yield* CliRuntime;
  const xcode =
    runtime.platform === "darwin"
      ? [yield* checkCommand("xcode", "Xcode CLI tools", "xcode-select", ["-p"])]
      : [];
  return [
    yield* checkNode,
    yield* checkBsdiff,
    ...xcode,
    yield* checkCommand("keytool", "keytool (Android signing)", "keytool", ["-help"]),
    yield* checkServerHealth,
    yield* checkAuth,
    yield* checkProjectLink,
    yield* checkProjectType,
    yield* checkBuildConfig,
  ];
});

const statusIcon = (status: CheckStatus): string => {
  if (status === "pass") {
    return "[OK]  ";
  }
  if (status === "warn") {
    return "[WARN]";
  }
  return "[FAIL]";
};

const renderHuman = (checks: readonly CheckResult[]) => {
  const rows: (readonly string[])[] = checks.map((check) => [
    statusIcon(check.status),
    check.name,
    check.message,
  ]);
  return printHumanTable(["", "Check", "Detail"], rows);
};

const computeExitCode = (checks: readonly CheckResult[]): number =>
  checks.some((check) => check.status === "fail") ? 6 : 0;

export const doctorCommand = Command.make(
  "doctor",
  {},
  Effect.fn(
    function* () {
      const runtime = yield* CliRuntime;
      const checks = yield* runChecks;
      yield* renderHuman(checks);
      const exitCode = computeExitCode(checks);
      if (exitCode !== 0) {
        yield* runtime.setExitCode(exitCode);
      }
      return { checks };
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Run diagnostic checks (Node, signing tools, server reachability, auth, config)",
  ),
);
