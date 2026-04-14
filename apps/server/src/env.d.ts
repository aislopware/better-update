declare global {
  interface Env {
    readonly ASSETS_BUCKET_NAME?: string;
    readonly TEST_MODE?: string;
  }
}

export {};
