/** Set to `1` to keep Xcode's index-while-building on for a CLI build. */
export const XCODE_INDEX_STORE_ENV = "BETTER_UPDATE_XCODE_INDEX_STORE";

/**
 * Build-setting overrides for every compiling `xcodebuild` the CLI runs
 * (simulator build, device archive, macOS archive).
 *
 * `COMPILER_INDEX_STORE_ENABLE=NO` turns off index-while-building. Xcode
 * enables it even from the command line, so every clang and swiftc call also
 * writes an index store. That store only feeds the IDE's code navigation, and
 * nothing reads it in a staged build that is thrown away afterwards. Skipping
 * it saves a share of compile time, most on Swift, which ccache does not cover.
 * It changes no compiled output.
 * `BETTER_UPDATE_XCODE_INDEX_STORE=1` keeps indexing on, for a build phase or
 * tool that reads the index.
 */
export const xcodeCompileSettings = (env: Readonly<Record<string, string>>): readonly string[] =>
  env[XCODE_INDEX_STORE_ENV] === "1" ? [] : ["COMPILER_INDEX_STORE_ENABLE=NO"];
