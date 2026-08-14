import { defineConfig } from "vitest/config";
import path from "node:path";

const abs = (p: string) => path.resolve(__dirname, p);

export default defineConfig({
  resolve: {
    alias: {
      "@intentguard/core": abs("../packages/core/src/index.ts"),
      "@intentguard/oracle": abs("../packages/oracle/src/index.ts"),
      "@intentguard/agents": abs("../packages/agents/src/index.ts"),
      "@intentguard/simulator": abs("../packages/simulator/src/index.ts"),
      "@intentguard/attestor": abs("../packages/attestor/src/index.ts"),
      "@intentguard/monitor": abs("../packages/monitor/src/index.ts"),
      "@intentguard/api": abs("../packages/api/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["e2e/**/*.test.ts"],
    exclude: ["packages/**", "node_modules/**"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    sequence: { concurrent: false },
  },
});
