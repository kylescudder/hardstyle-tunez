import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: { enabled: false },
    include: ["e2e/**/*.e2e.test.ts"],
  },
});
