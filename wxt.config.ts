import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

// 権限・CSP はこのファイルでのみ管理する（docs/tech-stack.md §2）。
// 変更時は tests/build/manifest.test.ts の期待値を更新し、PR で理由を説明して人間の承認を得ること。
export default defineConfig({
  srcDir: "src",
  publicDir: "src/public",
  modules: ["@wxt-dev/module-react"],
  // 依存関係を明示するため自動インポートは使わない
  imports: false,
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: "__MSG_extName__",
    description: "__MSG_extDescription__",
    default_locale: "ja",
    minimum_chrome_version: "116",
    // M1 までに必要な権限のみ。OpenAI の host_permissions は M2 で docs/tech-stack.md §2 の一覧から追加する。
    permissions: ["contextMenus", "sidePanel", "activeTab", "scripting", "storage"],
    host_permissions: ["https://api.anthropic.com/*"],
  },
});
