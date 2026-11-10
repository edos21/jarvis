import { defineConfig } from "vitest/config";

// Separate from vite.config.ts, whose root is web/: tests live in server/ and shared/ too.
export default defineConfig({
  test: { include: ["server/**/*.test.ts", "shared/**/*.test.ts", "web/**/*.test.{ts,tsx}"] },
});
