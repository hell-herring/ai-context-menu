import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// 本番ビルド（`pnpm build`）の出力を検査する。docs/guardrails.md §5
const OUTPUT_DIR = path.resolve(import.meta.dirname, "../../.output/chrome-mv3");

/** テスト専用コードに含めるマーカー。本番ビルドに含まれてはならない */
const TEST_ONLY_MARKER = "__AICM_TEST_ONLY__";

async function readManifest(): Promise<Record<string, unknown>> {
  const text = await readFile(path.join(OUTPUT_DIR, "manifest.json"), "utf8");
  return JSON.parse(text) as Record<string, unknown>;
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((e) => path.join(e.parentPath, e.name));
}

describe("本番ビルドの manifest", () => {
  // 権限・CSP を変更する場合は、この期待値を更新し PR で理由を説明して人間の承認を得ること
  it("権限・CSP・コンテンツスクリプトが許可された内容から変わっていない", async () => {
    const manifest = await readManifest();
    expect({
      manifest_version: manifest.manifest_version,
      minimum_chrome_version: manifest.minimum_chrome_version,
      permissions: manifest.permissions,
      optional_permissions: manifest.optional_permissions,
      host_permissions: manifest.host_permissions,
      optional_host_permissions: manifest.optional_host_permissions,
      content_security_policy: manifest.content_security_policy,
      content_scripts: manifest.content_scripts,
      web_accessible_resources: manifest.web_accessible_resources,
      externally_connectable: manifest.externally_connectable,
    }).toEqual({
      manifest_version: 3,
      minimum_chrome_version: "116",
      permissions: ["contextMenus", "sidePanel", "activeTab", "scripting", "storage"],
      optional_permissions: undefined,
      host_permissions: ["https://api.anthropic.com/*"],
      optional_host_permissions: undefined,
      content_security_policy: undefined,
      content_scripts: undefined,
      web_accessible_resources: undefined,
      externally_connectable: undefined,
    });
  });

  it("サイドパネル・設定画面・既定ロケールが設定されている", async () => {
    const manifest = await readManifest();
    expect(manifest.side_panel).toEqual({ default_path: "sidepanel.html" });
    expect(manifest.options_ui).toEqual({ page: "options.html", open_in_tab: true });
    expect(manifest.default_locale).toBe("ja");
  });

  it("注入用の抽出スクリプトが出力されている（ページからは読み込めない）", async () => {
    const files = (await listFiles(OUTPUT_DIR)).map((file) => path.relative(OUTPUT_DIR, file));
    expect(files).toContain("extract.js");
  });
});

describe("本番ビルドの出力", () => {
  it(`テスト専用マーカー ${TEST_ONLY_MARKER} を含まない`, async () => {
    const files = await listFiles(OUTPUT_DIR);
    expect(files.length).toBeGreaterThan(0);

    const offending: string[] = [];
    for (const file of files) {
      const content = await readFile(file);
      if (content.includes(TEST_ONLY_MARKER)) {
        offending.push(path.relative(OUTPUT_DIR, file));
      }
    }
    expect(offending).toEqual([]);
  });
});
