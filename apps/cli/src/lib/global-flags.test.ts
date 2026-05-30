import { parseGlobalFlags, stripGlobalFlags } from "./global-flags";

// These flags are GLOBAL and load-bearing: index.ts derives the OutputMode +
// InteractiveMode layers from them before citty parses anything, so a regression
// here silently breaks the CI contract for EVERY command. Pin the full
// precedence matrix so any change to the resolution rules is deliberate.

const NO_CI = {} as NodeJS.ProcessEnv;
const CI = { CI: "true" } as NodeJS.ProcessEnv;

describe("parseGlobalFlags precedence", () => {
  it("no flags, no CI: human + interactive", () => {
    expect(parseGlobalFlags([], NO_CI)).toStrictEqual({ json: false, nonInteractive: false });
  });

  it("--json alone forces non-interactive (the stdout-only contract)", () => {
    // clack prompts render to stdout; a prompt in JSON mode would corrupt the
    // single-envelope stream, so --json hard-implies non-interactive.
    expect(parseGlobalFlags(["--json"], NO_CI)).toStrictEqual({
      json: true,
      nonInteractive: true,
    });
  });

  it("--non-interactive alone: human output, no prompts", () => {
    expect(parseGlobalFlags(["--non-interactive"], NO_CI)).toStrictEqual({
      json: false,
      nonInteractive: true,
    });
  });

  it("CI detection alone defaults to non-interactive (human output)", () => {
    expect(parseGlobalFlags([], CI)).toStrictEqual({ json: false, nonInteractive: true });
  });

  it("explicit --interactive overrides CI detection (opts back into prompts)", () => {
    expect(parseGlobalFlags(["--interactive"], CI)).toStrictEqual({
      json: false,
      nonInteractive: false,
    });
  });

  it("--interactive + --json: json WINS — non-interactive despite --interactive", () => {
    // The decided semantics: --json's no-chrome-on-stdout contract is stronger
    // than an explicit --interactive request. The combination cannot enable
    // prompts, since a clack prompt would pollute the JSON stdout stream.
    expect(parseGlobalFlags(["--interactive", "--json"], NO_CI)).toStrictEqual({
      json: true,
      nonInteractive: true,
    });
  });

  it("--interactive + --json under CI: still json-wins non-interactive", () => {
    expect(parseGlobalFlags(["--interactive", "--json"], CI)).toStrictEqual({
      json: true,
      nonInteractive: true,
    });
  });

  it("--non-interactive + --interactive: --non-interactive wins (explicit opt-out)", () => {
    expect(parseGlobalFlags(["--non-interactive", "--interactive"], NO_CI)).toStrictEqual({
      json: false,
      nonInteractive: true,
    });
  });

  it("treats CI=1 the same as CI=true", () => {
    expect(parseGlobalFlags([], { CI: "1" } as NodeJS.ProcessEnv).nonInteractive).toBe(true);
  });

  it("ignores other CI values (e.g. CI=false)", () => {
    expect(parseGlobalFlags([], { CI: "false" } as NodeJS.ProcessEnv).nonInteractive).toBe(false);
  });
});

describe(stripGlobalFlags, () => {
  it("removes all three global flags so citty never sees them", () => {
    expect(
      stripGlobalFlags(["update", "publish", "--json", "--non-interactive", "--interactive", "-x"]),
    ).toStrictEqual(["update", "publish", "-x"]);
  });

  it("leaves a flag-free argv untouched", () => {
    expect(stripGlobalFlags(["devices", "list"])).toStrictEqual(["devices", "list"]);
  });
});
