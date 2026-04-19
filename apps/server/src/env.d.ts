declare global {
  interface Env {
    readonly ASSETS_BUCKET_NAME?: string;
    readonly CLOUDFLARE_API_TOKEN?: string;
    readonly TEST_MODE?: string;
    readonly ENVIRONMENT?: "development" | "production" | "staging";
  }
}

export {};
