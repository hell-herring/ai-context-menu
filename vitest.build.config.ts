import { defineConfig } from "vitest/config";

// ビルド成果物の検査（`pnpm build` の後に `pnpm test:build` で実行する）
export default defineConfig({
  test: {
    include: ["tests/build/**/*.test.ts"],
    environment: "node",
  },
});
