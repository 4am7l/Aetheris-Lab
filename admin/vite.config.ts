import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "/fonts/samsung.ttf": fileURLToPath(new URL("../public/fonts/samsung.ttf", import.meta.url)),
    },
  },
  build: {
    sourcemap: false,
  },
});
