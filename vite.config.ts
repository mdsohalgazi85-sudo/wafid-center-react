import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    lib: {
      entry: "src/main.tsx",
      name: "WafidCenterContent",
      formats: ["iife"],
      fileName: () => "content.js"
    },
    rollupOptions: {
      external: [],
      output: {
        assetFileNames: "assets/[name][extname]"
      }
    }
  },
  define: {
    "process.env": { NODE_ENV: "production" },
    process: { env: { NODE_ENV: "production" } }
  }
});
