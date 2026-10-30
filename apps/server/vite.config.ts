import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

// eslint-disable-next-line node/no-process-env -- config file
const portless = process.env["PORTLESS"] === "1";

export default defineConfig({
  plugins: [
    // Local dev ignores the R2 bindings' `dev: { remote: true }` — the
    // edge-preview proxy script cannot host our Durable Objects, so any remote
    // binding makes `vite dev` fail with CF API code 10375. The flag only
    // matters to the `e2e-pool-r2` vitest project, which opts back in.
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
