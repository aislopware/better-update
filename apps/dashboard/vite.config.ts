import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// eslint-disable-next-line node/no-process-env -- config file
const portless = process.env["PORTLESS"] === "1";
const defaultProxyTarget = portless
  ? "https://api.better-update.localhost"
  : "http://localhost:6781";

export default defineConfig({
  plugins: [tailwindcss(), tanstackRouter(), react()],
  server: {
    // eslint-disable-next-line node/no-process-env -- config file
    port: Number(process.env["PORT"]) || 6780,
    ...(portless && {
      hmr: { host: "dashboard.better-update.localhost", protocol: "wss" as const, clientPort: 443 },
      allowedHosts: ["dashboard.better-update.localhost"],
    }),
    proxy: {
      "/api": {
        // eslint-disable-next-line node/no-process-env -- config file
        target: process.env["DASHBOARD_API_PROXY_TARGET"] ?? defaultProxyTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
