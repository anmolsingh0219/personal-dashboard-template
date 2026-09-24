import { defineConfig } from "vitest/config";

// Unit tests cover the pure logic (email rules, planner math); kept separate from the
// Cloudflare Vite plugin so tests run in plain Node.
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"] },
});
