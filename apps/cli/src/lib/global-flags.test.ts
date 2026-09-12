import { detectJsonMode, globalFlagAt, resolveGlobalFlags } from "./global-flags";

// These flags are GLOBAL and load-bearing: the root command derives the
// OutputMode + InteractiveMode layers from them, so a regression here silently
// breaks the CI contract for EVERY command. Pin the full precedence matrix so
// any change to the resolution rules is deliberate.

const flags = (overrides: { json?: boolean; nonInteractive?: boolean; interactive?: boolean }) => ({
  json: false,
  nonInteractive: false,
  interactive: false,
  ...overrides,
});

describe("resolveGlobalFlags precedence", () => {
  it("no flags, no CI: human + interactive", () => {
    expect(resolveGlobalFlags(flags({}), undefined)).toStrictEqual({
      json: false,
      nonInteractive: false,
    });
  });

  it("--json alone forces non-interactive (the stdout-only contract)", () => {
    // Prompts render to stdout; a prompt in JSON mode would corrupt the
    // single-envelope stream, so --json hard-implies non-interactive.
    expect(resolveGlobalFlags(flags({ json: true }), undefined)).toStrictEqual({
      json: true,
      nonInteractive: true,
    });
  });

  it("--non-interactive alone: human output, no prompts", () => {
    expect(resolveGlobalFlags(flags({ nonInteractive: true }), undefined)).toStrictEqual({
      json: false,
      nonInteractive: true,
    });
  });

  it("CI detection alone defaults to non-interactive (human output)", () => {
    expect(resolveGlobalFlags(flags({}), "true")).toStrictEqual({
      json: false,
      nonInteractive: true,
    });
  });

  it("explicit --interactive overrides CI detection (opts back into prompts)", () => {
    expect(resolveGlobalFlags(flags({ interactive: true }), "true")).toStrictEqual({
      json: false,
      nonInteractive: false,
    });
  });

  it("--interactive + --json: json WINS — non-interactive despite --interactive", () => {
    expect(resolveGlobalFlags(flags({ interactive: true, json: true }), undefined)).toStrictEqual({
      json: true,
      nonInteractive: true,
    });
  });

  it("--interactive + --json under CI: still json-wins non-interactive", () => {
    expect(resolveGlobalFlags(flags({ interactive: true, json: true }), "true")).toStrictEqual({
      json: true,
      nonInteractive: true,
    });
  });

  it("--non-interactive + --interactive: --non-interactive wins (explicit opt-out)", () => {
    expect(
      resolveGlobalFlags(flags({ nonInteractive: true, interactive: true }), undefined),
    ).toStrictEqual({ json: false, nonInteractive: true });
  });

  it("treats CI=1 the same as CI=true", () => {
    expect(resolveGlobalFlags(flags({}), "1").nonInteractive).toBe(true);
  });

  it("ignores other CI values (e.g. CI=false)", () => {
    expect(resolveGlobalFlags(flags({}), "false").nonInteractive).toBe(false);
  });
});

describe("detectJsonMode (pre-parse --json detection for the entrypoint)", () => {
  it("is off by default", () => {
    expect(detectJsonMode(["devices", "list"])).toBe(false);
  });

  it("sees --json anywhere before the operand separator", () => {
    expect(detectJsonMode(["--json", "devices", "list"])).toBe(true);
    expect(detectJsonMode(["devices", "list", "--json"])).toBe(true);
    expect(detectJsonMode(["devices", "--json", "list"])).toBe(true);
  });

  it("the first --json / --no-json occurrence wins, like the parser", () => {
    expect(detectJsonMode(["--json", "devices", "--no-json"])).toBe(true);
    expect(detectJsonMode(["--no-json", "devices", "--json"])).toBe(false);
    expect(detectJsonMode(["--json=false", "devices"])).toBe(false);
  });

  it("ignores everything after `--` (operands of `env exec`)", () => {
    expect(detectJsonMode(["env", "exec", "production", "--", "cmd", "--json"])).toBe(false);
  });

  it("honours an explicit boolean value, inline or as the next token", () => {
    expect(detectJsonMode(["--json=true", "devices"])).toBe(true);
    expect(detectJsonMode(["--json", "true", "devices"])).toBe(true);
    expect(detectJsonMode(["--json", "false", "devices"])).toBe(false);
    expect(detectJsonMode(["--json", "false", "devices", "--json"])).toBe(false);
  });
});

describe("globalFlagAt (argv scanner shared with the command-name walk)", () => {
  it("recognises every spelling the parser accepts", () => {
    expect(globalFlagAt(["--json"], 0)).toStrictEqual({ name: "json", value: true, span: 1 });
    expect(globalFlagAt(["--no-json"], 0)).toStrictEqual({ name: "json", value: false, span: 1 });
    expect(globalFlagAt(["--json=false"], 0)).toStrictEqual({
      name: "json",
      value: false,
      span: 1,
    });
    expect(globalFlagAt(["--json", "false"], 0)).toStrictEqual({
      name: "json",
      value: false,
      span: 2,
    });
    expect(globalFlagAt(["--interactive", "devices"], 0)).toStrictEqual({
      name: "interactive",
      value: true,
      span: 1,
    });
  });

  it("spans the value of --log-level", () => {
    expect(globalFlagAt(["--log-level", "debug"], 0)).toStrictEqual({
      name: "log-level",
      value: undefined,
      span: 2,
    });
    expect(globalFlagAt(["--log-level=debug"], 0)).toStrictEqual({
      name: "log-level",
      value: undefined,
      span: 1,
    });
  });

  it("is undefined for commands, positionals and non-global flags", () => {
    expect(globalFlagAt(["devices"], 0)).toBeUndefined();
    expect(globalFlagAt(["--limit", "3"], 0)).toBeUndefined();
    expect(globalFlagAt(["--no-limit"], 0)).toBeUndefined();
    expect(globalFlagAt(["--"], 0)).toBeUndefined();
  });
});
