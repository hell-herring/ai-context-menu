import { defineConfig } from "@playwright/test";

// E2E テスト（`pnpm build:e2e` の後に `pnpm test:e2e`）。
// モックプロバイダ入りの E2E 用ビルドを読み込んだ Chromium で動かし、実 AI API は呼ばない（docs/guardrails.md §5）
export default defineConfig({
  testDir: "tests/e2e",
  // 拡張を読み込んだブラウザをテストごとに起動するため、並列数は控えめにする
  workers: process.env.CI ? 2 : undefined,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    locale: "ja-JP",
    trace: "retain-on-failure",
  },
});
