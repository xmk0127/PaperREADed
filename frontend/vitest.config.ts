import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    // KaTeX-heavy reading pages create large DOMs; avoid CPU contention between
    // accessibility suites so their interaction timeouts remain meaningful.
    fileParallelism: false,
    testTimeout: process.env.CI === "true" ? 20_000 : 5_000,
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
