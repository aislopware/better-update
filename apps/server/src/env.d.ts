declare global {
  // Worker secrets (`wrangler secret put`, or `.env.local` in development).
  // cloudflare.config.ts does not declare them: `bindings.secret()` makes every
  // declared secret required at deploy, and most of these are optional, so the
  // generated types cannot know them. Declared on `Cloudflare.Env` — the type of
  // `env` from "cloudflare:workers" — so that `env` still satisfies `Env`.
  namespace Cloudflare {
    interface Env {
      readonly BETTER_AUTH_SECRET: string;
      readonly R2_SECRET_ACCESS_KEY: string;
      readonly INSTALL_TOKEN_SECRET?: string;
      // Without it the server has no APT repository (the feed answers 404).
      readonly APT_SIGNING_SECRET?: string;
      readonly GITHUB_CLIENT_SECRET?: string;
      readonly GOOGLE_CLIENT_SECRET?: string;
      // Reads Analytics Engine through its SQL API; unset = analytics unavailable.
      readonly CLOUDFLARE_API_TOKEN?: string;
    }
  }

  interface Env {
    readonly ASSETS_BUCKET_NAME?: string;
    readonly TEST_MODE?: string;
    readonly ENVIRONMENT?: "development" | "production" | "staging";
    // Opt-in: emit a true RFC-3229 `226 IM Used` status (instead of 200) for
    // bsdiff patch responses. Off by default — 200 is the safe default because
    // some non-delta-aware proxy caches mishandle 226, and the device accepts
    // both equally (FileDownloader treats any 2xx as success). Stored as the
    // string "true" in the config's `vars` (Cloudflare vars are strings).
    readonly EMIT_HTTP_226?: string;
  }
}

export {};
