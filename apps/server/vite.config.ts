import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

// eslint-disable-next-line node/no-process-env -- config file
const portless = process.env["PORTLESS"] === "1";

export default defineConfig({
  plugins: [cloudflare()],
  server: {
    // eslint-disable-next-line node/no-process-env -- config file
    port: Number(process.env["PORT"]) || 6781,
    // Worker owns CORS (see src/index.ts corsHeaders). Vite's default CORS
    // Middleware intercepts OPTIONS preflights and strips `credentials: true`,
    // Breaking cross-subdomain auth from accounts/console SPAs.
    cors: false,
    ...(portless && {
      hmr: { host: "api.better-update.localhost", protocol: "wss" as const, clientPort: 443 },
      allowedHosts: ["api.better-update.localhost"],
    }),
  },
});
