import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: [
      "tests/integration/neotoma_adapter.test.ts",
    ],
    sequence: {
      concurrent: false,
    },
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
