import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  publicDir: "public", // এখানে manifest.json আছে
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      // আলাদা এন্ট্রি—manifest.json যেসব ফাইল expect করে সেগুলোর নাম মেলাতে হবে
      input: {
        background: resolve(__dirname, "src/background.ts"),
        "content-bridge": resolve(__dirname, "src/content-bridge.ts"),
        "content-main": resolve(__dirname, "src/content-main.tsx"),
      },
      output: {
        // আউটপুট ফাইলনেম: assets/background.js, assets/content-bridge.js, assets/content-main.js
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
        // service worker-এ code splitting ইস্যু কমাতে চাইলে manualChunks বন্ধও রাখতে পারেন:
        // manualChunks: undefined,
      },
    },
    target: ["chrome114"], // MV3 এর জন্য যথেষ্ট
  },
  define: {
    "process.env": { NODE_ENV: "production" },
  },
});
