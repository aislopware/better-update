import nodeModule from "node:module";

/**
 * Lets `@expo/config` evaluate `app.config.ts` under Bun.
 *
 * `@expo/require-utils` (the loader behind `@expo/config`) transpiles `.ts`
 * with the PROJECT's `typescript`, required at run time from the user's
 * `node_modules` (the build keeps it external), and otherwise falls back to
 * Node's `module.stripTypeScriptTypes`. A project with TypeScript ≤ 6 takes
 * the first path, as under Expo CLI. One without TypeScript, or on TypeScript
 * 7.0 (a native compiler whose npm package has no `transpileModule`), takes
 * the fallback, which Bun does not implement — so the raw source would reach
 * `Module._compile` and die on the first type annotation. Bun ships a
 * TypeScript transpiler of its own; expose it under the Node API name so the
 * fallback lands.
 *
 * `require-utils` reads `typeof stripTypeScriptTypes` ONCE at module init, and
 * `@expo/config-plugins` (imported statically elsewhere) pulls it in during
 * startup — so this must be the first import of the CLI entrypoint. Importing
 * it again later is harmless: the install is idempotent, and a no-op on Node
 * ≥ 22.13 (native) or when `Bun` is absent.
 */
export const installStripTypeScriptTypes = (): void => {
  if (typeof nodeModule.stripTypeScriptTypes === "function" || typeof Bun === "undefined") {
    return;
  }
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  // Babel's `_interopRequireWildcard` (what `require-utils` reads `node:module`
  // through) copies ENUMERABLE own props into a fresh namespace object, so a
  // non-enumerable define would be invisible to it.
  Object.defineProperty(nodeModule, "stripTypeScriptTypes", {
    value: (code: string): string => transpiler.transformSync(code),
    enumerable: true,
    configurable: true,
    writable: true,
  });
};

installStripTypeScriptTypes();
