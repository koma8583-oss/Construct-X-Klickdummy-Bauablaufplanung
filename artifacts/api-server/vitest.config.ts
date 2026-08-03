import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Runs in every worker before any test file — sets env vars that tests need.
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});
