import { defineConfig } from "vite";

export default defineConfig({
  root: "apps/client",
  envDir: process.cwd(),
  build: { outDir: "../../dist", emptyOutDir: true },
  server: { host: "127.0.0.1", strictPort: true },
});
