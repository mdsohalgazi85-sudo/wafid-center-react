import { resolve } from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        content: resolve(__dirname, "src/main.tsx"),
        background: resolve(__dirname, "src/background.ts")
      },
      output: {
        entryFileNames: ({ name }) =>
          name === "background" ? "background.js" : "content.js",
        assetFileNames: "assets/[name][extname]",
        chunkFileNames: "assets/[name].js"
      }
    }
  },
  define: {
    "process.env": { NODE_ENV: "production" },
    process: { env: { NODE_ENV: "production" } }
  }
});
