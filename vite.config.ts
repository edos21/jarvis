import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./web/src", import.meta.url)) } },
  server: {
    host: "127.0.0.1",
    port: 4418,
    proxy: { "/api": { target: "http://127.0.0.1:4417" } },
  },
  build: { outDir: "../dist/web", emptyOutDir: true },
});
