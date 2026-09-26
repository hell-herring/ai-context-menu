import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { EXTENSION_DIR } from "./fixtures";

// 本番ビルドの検査（tests/build/manifest.test.ts）が「マーカーを含まない」ことで
// テスト専用コードの混入を検出できる前提を確かめる

test("E2E 用ビルドにはテスト専用マーカーが残る（本番ビルドの混入検査が機能する前提）", async () => {
  const entries = await readdir(EXTENSION_DIR, { recursive: true, withFileTypes: true });
  const marked: string[] = [];
  for (const entry of entries.filter((entry) => entry.isFile())) {
    const file = path.join(entry.parentPath, entry.name);
    if ((await readFile(file)).includes("__AICM_TEST_ONLY__")) {
      marked.push(path.relative(EXTENSION_DIR, file));
    }
  }
  // モックプロバイダと background のテスト用フック
  expect(marked).toContain("background.js");
  expect(marked.some((file) => file.includes("mock-provider"))).toBe(true);
});
