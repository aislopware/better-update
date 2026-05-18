import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

// eslint-disable-next-line node/no-process-env -- config file
const portless = process.env["PORTLESS"] === "1";

export default defineConfig({
  plugins: [
    // Local dev bypasses `remote: true` on R2 bindings — the edge-preview
    // proxy script cannot host our Durable Objects, so any remote binding
    // makes `vite dev` fail with CF API code 10375. Production deploys
    // (`wrangler deploy`) honor the wrangler.jsonc `remote: true` flags
    // because they don't go through the vite-plugin edge-preview path.
    cloudflare({ inspectorPort: 9229, remoteBindings: false }),
  ],
  server: {
    // eslint-disable-next-line node/no-process-env -- config file
    port: Number(process.env["PORT"]) || 6781,
    ...(portless && {
      hmr: { host: "server.better-update.localhost", protocol: "wss" as const, clientPort: 443 },
      allowedHosts: ["server.better-update.localhost"],
    }),
  },
});
