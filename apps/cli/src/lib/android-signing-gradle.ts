export interface RenderSigningGradleInput {
  readonly keystorePath: string;
  readonly storePassword: string;
  readonly keyAlias: string;
  readonly keyPassword: string;
}

/**
 * Escape a Groovy single-quoted string literal: backslashes, single quotes,
 * and `$` (to prevent string interpolation on Groovy double-quoted strings,
 * though we use single quotes everywhere for safety).
 */
const escapeGroovySingleQuoted = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\$/g, "\\$");

/**
 * Render a Gradle init script that injects a `release` signing config into
 * every Android application module after evaluation. This is passed to
 * `./gradlew --init-script <path>` so the keystore never has to live in the
 * project tree.
 */
export const renderSigningGradle = ({
  keystorePath,
  storePassword,
  keyAlias,
  keyPassword,
}: RenderSigningGradleInput): string =>
  `allprojects {
  afterEvaluate { project ->
    if (project.plugins.hasPlugin('com.android.application')) {
      project.android {
        signingConfigs {
          release {
            storeFile file('${escapeGroovySingleQuoted(keystorePath)}')
            storePassword '${escapeGroovySingleQuoted(storePassword)}'
            keyAlias '${escapeGroovySingleQuoted(keyAlias)}'
            keyPassword '${escapeGroovySingleQuoted(keyPassword)}'
          }
        }
        buildTypes {
          release {
            signingConfig signingConfigs.release
          }
        }
      }
    }
  }
}
`;
