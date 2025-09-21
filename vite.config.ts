import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  publicDir: "public", // 
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      // আলাদা entry: background + দুটো content script
      input: {
        background: resolve(__dirname, "src/background.ts"),
        "content-main": resolve(__dirname, "src/content-main.tsx"),
        "content-bridge": resolve(__dirname, "src/content-bridge.ts"),
        // চাইলে css-টাকেও আলাদা asset হিসেবে তুলতে পারো:
        styles: resolve(__dirname, "src/styles.css"),
      },
      output: {
        // প্রত্যেকটার নিজের নাম থাকবে (overwrite হবে না)
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
        // service worker-এ dynamic import না চাইলে চাইলে নিচের লাইনও ব্যবহার করতে পারো:
        // inlineDynamicImports: false
      },
      // service worker-এর জন্য সাধারণত code splitting কম রাখা ভালো;
      // কিন্তু উপরের per-file naming-এ সমস্যা হবে না।
    },
    target: ["chrome114"], // MV3 target আধুনিক Chrome
  },
  // process shim লাগলে নিচের define রাখতে পারো, নইলে বাদ
  define: {
    "process.env": { NODE_ENV: "production" },
  },
});
