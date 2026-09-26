import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

// 単体テスト。実 AI API は呼ばない（docs/guardrails.md §5）
export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    include: ["src/**/*.test.{ts,tsx}", "tests/unit/**/*.test.{ts,tsx}"],
    environment: "happy-dom",
    restoreMocks: true,
  },
});
