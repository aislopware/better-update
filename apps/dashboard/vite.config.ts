import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), tanstackRouter(), react()],
  server: {
    // eslint-disable-next-line node/no-process-env -- config file
    port: Number(process.env["PORT"]) || 6780,
    proxy: {
      "/api": {
        // eslint-disable-next-line node/no-process-env -- config file
        target: process.env["DASHBOARD_API_PROXY_TARGET"] ?? "http://localhost:6781",
        changeOrigin: true,
      },
    },
  },
});
