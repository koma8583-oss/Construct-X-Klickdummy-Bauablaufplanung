import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    // All API tests share one logical PostgreSQL database. Run files in one
    // worker so a file-level teardown cannot race another file's fixtures.
    fileParallelism: false,
    // Runs before the test files in the single worker — sets env vars that
    // tests need.
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});
