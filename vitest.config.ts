import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // V2H.8: include pure client-side helpers under client/src/lib/. The Node
    // environment is fine for pure-logic tests that don't render JSX. Tests
    // that require a DOM (React Testing Library) would need their own config
    // with environment: "jsdom" — none currently exist.
    include: [
      "server/**/*.test.ts",
      "client/src/lib/**/*.test.ts",
    ],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client/src"),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
});
