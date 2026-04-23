import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { reactDevtools } from "agent-react-devtools/vite";
import { defineConfig } from "vite";

// eslint-disable-next-line node/no-process-env -- config file
const portless = process.env["PORTLESS"] === "1";
// eslint-disable-next-line node/no-process-env -- config file
const apiProxyTarget = process.env["WEB_API_PROXY_TARGET"] ?? process.env.API_URL;
// eslint-disable-next-line node/no-process-env -- config file
const devtoolsEnabled = process.env["REACT_DEVTOOLS"] === "1";

export default defineConfig({
  plugins: [
    ...(devtoolsEnabled ? [reactDevtools()] : []),
    tailwindcss(),
    cloudflare({ viteEnvironment: { name: "ssr" }, inspectorPort: 9230 }),
    tanstackStart(),
    viteReact(),
  ],
  server: {
    // eslint-disable-next-line node/no-process-env -- config file
    port: Number(process.env["PORT"]) || 6780,
    ...(apiProxyTarget
      ? {
          proxy: {
            "/api": { target: apiProxyTarget, changeOrigin: true, secure: false },
          },
        }
      : {}),
    ...(portless && {
      hmr: { host: "better-update.localhost", protocol: "wss" as const, clientPort: 443 },
      allowedHosts: ["better-update.localhost"],
    }),
  },
});
