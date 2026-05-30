declare global {
  interface Env {
    readonly ASSETS_BUCKET_NAME?: string;
    readonly CLOUDFLARE_API_TOKEN?: string;
    readonly TEST_MODE?: string;
    readonly ENVIRONMENT?: "development" | "production" | "staging";
    // Opt-in: emit a true RFC-3229 `226 IM Used` status (instead of 200) for
    // bsdiff patch responses. Off by default — 200 is the safe default because
    // some non-delta-aware proxy caches mishandle 226, and the device accepts
    // both equally (FileDownloader treats any 2xx as success). Stored as the
    // string "true" in wrangler vars (Cloudflare vars are strings).
    readonly EMIT_HTTP_226?: string;
  }
}

export {};
