import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  build: {
    emptyOutDir: true,
    outDir: "../site",
    rollupOptions: {
      input: {
        docs: fileURLToPath(new URL("./docs/index.html", import.meta.url)),
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
      },
    },
  },
});
