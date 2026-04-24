// eslint-disable-next-line eslint-plugin-import/no-nodejs-modules -- Vite config executes in Node; proxy uses http module
import http from "node:http";
// eslint-disable-next-line eslint-plugin-import/no-nodejs-modules -- Vite config executes in Node; proxy uses https module
import https from "node:https";

import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { reactDevtools } from "agent-react-devtools/vite";
import { defineConfig, loadEnv } from "vite";

import type { Plugin } from "vite";

// Cloudflare Vite plugin registers a catch-all dev middleware that handles
// `/api/*` with the SSR worker before Vite's `server.proxy` can run. Register
// Our own proxy earlier in the plugin array so it runs first.
const apiProxyPlugin = (target: string): Plugin => {
  const targetUrl = new URL(target);
  return {
    name: "api-proxy",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === undefined || !req.url.startsWith("/api/")) {
          next();
          return;
        }
        const headers = { ...req.headers, host: targetUrl.host };
        const defaultPort = targetUrl.protocol === "https:" ? 443 : 80;
        const proxyOptions = {
          hostname: targetUrl.hostname,
          port: targetUrl.port === "" ? defaultPort : Number(targetUrl.port),
          path: req.url,
          method: req.method,
          headers,
        };
        const handleProxyResponse = (proxyRes: http.IncomingMessage) => {
          res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
          proxyRes.pipe(res);
        };
        const proxyReq =
          targetUrl.protocol === "https:"
            ? https.request({ ...proxyOptions, rejectUnauthorized: false }, handleProxyResponse)
            : http.request(proxyOptions, handleProxyResponse);
        proxyReq.on("error", (err) => {
          res.statusCode = 502;
          res.end(`proxy error: ${err.message}`);
        });
        req.pipe(proxyReq);
      });
    },
  };
};

export default defineConfig(({ mode }) => {
  // Load .env* files into a local env bag — Vite does not auto-populate
  // `process.env` at config-evaluation time, so direct `process.env.FOO`
  // For .env vars would be undefined here.
  const env = loadEnv(mode, process.cwd(), "");
  // eslint-disable-next-line node/no-process-env -- config file
  const portless = process.env["PORTLESS"] === "1";
  const apiProxyTarget = env["WEB_API_PROXY_TARGET"];
  const devtoolsEnabled = env["REACT_DEVTOOLS"] === "1";

  return {
    plugins: [
      ...(devtoolsEnabled ? [reactDevtools()] : []),
      ...(apiProxyTarget !== undefined && apiProxyTarget !== ""
        ? [apiProxyPlugin(apiProxyTarget)]
        : []),
      tailwindcss(),
      cloudflare({ viteEnvironment: { name: "ssr" }, inspectorPort: 9230 }),
      tanstackStart(),
      viteReact(),
    ],
    server: {
      port: Number(env["PORT"]) || 6780,
      ...(portless && {
        hmr: { host: "better-update.localhost", protocol: "wss" as const, clientPort: 443 },
        allowedHosts: ["better-update.localhost"],
      }),
    },
  };
});
