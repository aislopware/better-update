import { renderSigningGradle } from "./android-signing-gradle";

describe(renderSigningGradle, () => {
  test("renders standard release signing config", () => {
    const script = renderSigningGradle({
      keystorePath: "/tmp/release.keystore",
      storePassword: "store-pass",
      keyAlias: "my-key",
      keyPassword: "key-pass",
    });
    expect(script).toMatchInlineSnapshot(`
      "allprojects {
        afterEvaluate { project ->
          if (project.plugins.hasPlugin('com.android.application')) {
            project.android {
              signingConfigs {
                release {
                  storeFile file('/tmp/release.keystore')
                  storePassword 'store-pass'
                  keyAlias 'my-key'
                  keyPassword 'key-pass'
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
      "
    `);
  });

  test("references com.android.application plugin check + afterEvaluate", () => {
    const script = renderSigningGradle({
      keystorePath: "/k",
      storePassword: "s",
      keyAlias: "a",
      keyPassword: "k",
    });
    expect(script).toContain("allprojects {");
    expect(script).toContain("afterEvaluate { project ->");
    expect(script).toContain("project.plugins.hasPlugin('com.android.application')");
    expect(script).toContain("signingConfigs {");
    expect(script).toContain("buildTypes {");
    expect(script).toContain("signingConfig signingConfigs.release");
  });

  test("escapes single quotes in passwords", () => {
    const script = renderSigningGradle({
      keystorePath: "/k",
      storePassword: "can't",
      keyAlias: "won't",
      keyPassword: "pass'word",
    });
    expect(script).toContain(String.raw`storePassword 'can\'t'`);
    expect(script).toContain(String.raw`keyAlias 'won\'t'`);
    expect(script).toContain(String.raw`keyPassword 'pass\'word'`);
  });

  test("escapes backslashes in path", () => {
    const script = renderSigningGradle({
      keystorePath: "C:\\keys\\release.keystore",
      storePassword: "s",
      keyAlias: "a",
      keyPassword: "k",
    });
    expect(script).toContain(String.raw`storeFile file('C:\\keys\\release.keystore')`);
  });

  test("escapes combined backslash and quote", () => {
    const script = renderSigningGradle({
      keystorePath: "/k",
      storePassword: "a\\'b",
      keyAlias: "x",
      keyPassword: "y",
    });
    // \\ → \\\\ and ' → \\'
    expect(script).toContain(String.raw`storePassword 'a\\\'b'`);
  });

  test("escapes `$` in passwords to prevent Groovy interpolation", () => {
    const script = renderSigningGradle({
      keystorePath: "/k",
      storePassword: "p@ss$word",
      keyAlias: "a",
      keyPassword: "$secret",
    });
    expect(script).toContain(String.raw`storePassword 'p@ss\$word'`);
    expect(script).toContain(String.raw`keyPassword '\$secret'`);
  });
});
