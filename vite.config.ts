import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { env } from "node:process";
const workerOrigin = env.AETHERIS_DEV_WORKER_ORIGIN ?? "http://127.0.0.1:8787";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api/": {
        target: workerOrigin,
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (upstream, request) => {
            // Translate only the local app's own origin across the development proxy.
            if (request.headers.origin === "http://" + request.headers.host) {
              upstream.setHeader("Origin", workerOrigin);
            }
          });
        },
      },
    },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          motion: ["motion/react"],
          validation: ["zod"],
          material: [
            "@mui/material/Button",
            "@mui/material/Dialog",
            "@mui/material/TextField",
            "@mui/material/Chip",
            "@mui/material/styles",
          ],
        },
      },
    },
  },
});
