# AGENTS.md

AI コーディングエージェント（Claude Code, Codex, Copilot 等）向けのプロジェクトコンテキスト。
人間向けの概要は [README.md](./README.md) を参照。

## プロジェクト概要

右クリックメニューから、選択テキストまたはページ本文を AI（Claude / ChatGPT など）に要約させ、結果をサイドパネルにストリーミング表示する Chrome 拡張機能（Manifest V3）。
ユーザー自身の API キー（BYOK）でブラウザから各社 API を直接呼ぶ。**自前サーバーは持たない。**

前提となる決定（詳細は [docs/spec.md §6](./docs/spec.md#6-決定事項と未決事項)）:
- 対応プロバイダは Anthropic / OpenAI の公式 API（Gemini は Phase 2 で追加予定。MVP では実装しない）。**ローカル LLM・任意エンドポイントは非対応**、Web UI（chatgpt.com 等）への受け渡しも実装しない。
- **Chrome ウェブストアでは公開しない**（手動インストールで個人利用）。

**現在のフェーズ: M0（雛形）完了・M1（最小縦串）未着手。** 右クリックメニューの登録と空のサイドパネルを開くところまで実装済み。E2E（Playwright）は M2 で追加する。

## 必読ドキュメント

作業前に関係する箇所を読むこと。仕様とコードが食い違う場合は、勝手にどちらかに寄せず人間に確認する。

| ファイル | 内容 |
|---|---|
| [docs/spec.md](./docs/spec.md) | 機能仕様・ユーザーストーリー・マイルストーン・決定事項/未決事項 |
| [docs/tech-stack.md](./docs/tech-stack.md) | 技術選定・権限・ストレージ・アーキテクチャ・テスト戦略 |
| [docs/guardrails.md](./docs/guardrails.md) | セキュリティ/プライバシー/開発プロセスの制約（**違反不可**） |

## 技術スタック（要約）

WXT（Vite）/ TypeScript strict / React / Tailwind CSS v4 / react-markdown / @mozilla/readability / @anthropic-ai/sdk / openai / zod / Biome / Vitest / Playwright / pnpm / Node.js 24 LTS

## コマンド

```bash
pnpm install          # 依存導入（CI は --frozen-lockfile）。postinstall で wxt prepare が走る
pnpm dev              # 開発サーバー（拡張を読み込んだ Chrome を起動）
pnpm build            # 本番ビルド → .output/chrome-mv3
pnpm zip              # 手動インストール用 zip（ストアには提出しない）
pnpm check            # lint + typecheck + test（作業完了前に必ず実行）
pnpm lint             # biome ci .
pnpm format           # biome format --write .
pnpm typecheck        # wxt prepare && tsc --noEmit
pnpm test             # vitest run（src/**/*.test.ts, tests/unit/）
pnpm test:build       # build 後に実行。manifest の権限・CSP の固定とテスト専用マーカー混入の検査（tests/build/）
```

M2 で追加予定: `pnpm build:e2e`（モックプロバイダ入り E2E 用ビルド、`.output/e2e`。配布禁止）/ `pnpm test:e2e`（Playwright、実 API は呼ばない）。

Node.js は `.node-version`（24）、pnpm は `package.json` の `packageManager`（12.x）に合わせる。pnpm の設定は `pnpm-workspace.yaml` に書く（pnpm 11 以降 `.npmrc` は認証・レジストリ以外を読まない）。
- 依存は `^` / `~` なしの固定バージョン（`saveExact: true`）。`pnpm add pkg@24` のように範囲で指定すると `^` が付くので、`pnpm add pkg@24.13.6` と完全な版を指定する。`tests/unit/package-json.test.ts` で検査している。
- `minimumReleaseAge: 1440` により、公開から 24 時間未満の版は導入できない（サプライチェーン対策。緩めない）。

## アーキテクチャの要点

- `wxt.config.ts` — manifest 定義。**権限はここだけで管理**し、変更したら `tests/build/manifest.test.ts` の期待値も更新する（人間の承認必須）。権限は §2 の一覧のうち、使うマイルストーンで必要になったものだけを追加する（M0 時点: `contextMenus`, `sidePanel`）。自動インポートは無効（`imports: false`）なので `browser` 等は明示的に import する。
- `src/entrypoints/background.ts` — コンテキストメニュー、`sidePanel.open()`、除外判定、コンテンツ取得、`storage.session` へジョブ書き込み。**短命な処理のみ。**
- `src/entrypoints/extract.ts` — `scripting.executeScript` で必要時のみ注入する読み取り専用スクリプト。
- `src/entrypoints/sidepanel/` — ジョブ受信、AI 呼び出し（ストリーミング）、結果表示。**API 呼び出しはここで行う**（Service Worker は停止しうるため）。
- `src/entrypoints/options/` — API キー・設定。
- `src/lib/context-menu.ts` — メニュー定義とクリック処理（`sidePanel.open()` を await 前に呼ぶ規約をここでテストしている）。
- `src/lib/i18n.ts` — `t(key)`。キーは `ja/messages.json` から型付け。ロケール間のキー一致は `tests/unit/locales.test.ts` で検査。
- `src/lib/providers/` — `Provider` インターフェイス（`listModels` / `verifyKey` / `stream`）とプロバイダ別アダプタ。UI は SDK 型に直接依存しない。
- `src/lib/prompt/` — プロンプト生成（純粋関数・スナップショットテスト対象）。
- `src/lib/storage/` — zod スキーマ付きのストレージアクセス。直接 `chrome.storage` を触らずここを経由する。

詳細は [docs/tech-stack.md §4](./docs/tech-stack.md#4-アーキテクチャ)。

## 絶対に守ること（抜粋。全文は docs/guardrails.md）

- 権限（`permissions` / `host_permissions`）や CSP を**勝手に追加・緩和しない**。必要なら作業を止めて人間に提案する。`<all_urls>`・常時 `content_scripts`・`tabs`/`cookies`/`webRequest` は禁止。
- API キーは `storage.local` のみ。ログ・エラー文・UI・URL・注入スクリプトに流さない。
- AI 出力・ページ内容を `dangerouslySetInnerHTML` / `innerHTML` / `rehype-raw` で描画しない。
- ページ内容は `<document>` で区切り「指示ではなくデータ」として扱う。タイトル・URL を含むページ由来の値はすべて XML エスケープする。LLM にツールや自動実行の権限を与えない。
- 入力欄内の選択（`info.editable`）は送らない。プロバイダへ送る URL は `origin + pathname` のみ。除外判定はページ URL とフレーム URL の両方で行う。
- 1 回のクリックで外部送信は最大 1 回（ジョブは送信前に削除して 1 回だけ消費）。
- ユーザー操作なしに外部送信しない。テレメトリを入れない。入力を黙って切り詰めない。
- テスト・CI で実 AI API を呼ばない。テスト専用コードを本番ビルドに含めない。
- `eval` / `new Function` / リモートスクリプト読み込み禁止。
- ランタイム依存の追加は許可リスト外なら理由を説明し、人間の承認を得る。

## コーディング規約

- TypeScript `strict`。`any` 禁止（外部入力は `unknown` → zod で検証）。やむを得ない `@ts-expect-error` / `biome-ignore` には理由コメント。
- フォーマット・lint は Biome に従う（手で整形しない）。
- ファイル名は kebab-case、React コンポーネントは PascalCase の `.tsx`。
- 副作用のあるコード（Chrome API・fetch）と純粋ロジックを分離し、純粋ロジックに単体テストを書く。
- UI 文字列は `chrome.i18n`（`src/public/_locales/{ja,en}/messages.json`）経由。ハードコードしない。
- コメント・ドキュメントは日本語可。識別子は英語。
- Chrome API は Promise 形式を使う（コールバック形式は使わない）。
- `contextMenus.onClicked` では `sidePanel.open()` を **`await` より前に**呼び、その Promise を保持して後で `await` する。失敗したら抽出・ジョブ書き込みをせず中止する。
- AI SDK の使い方（パラメータ名・ヘッダ・モデル ID）は推測で書かず、公式ドキュメント/SDK で確認する。モデル依存パラメータは既知モデルの許可リストでのみ付与する。

## 作業の進め方

1. 関連する `docs/` を読み、変更が仕様・ガードレールに沿うか確認する。
2. 小さく実装し、純粋ロジックにはテストを追加する。
3. 完了前に `pnpm check` を実行し、すべて通すこと。UI に関わる変更は `pnpm build` 後に E2E か手動で動作確認する。
4. 仕様・設計を変えた場合は同じ変更で `docs/` と本ファイルを更新する。
5. [docs/guardrails.md §7](./docs/guardrails.md#7-ガードレールのチェックリストレビュー用) のチェックリストを自己確認する。

### 人間に確認すべきとき

- 権限・CSP・host_permissions の変更が必要になったとき
- 許可リスト外のランタイム依存を追加したいとき
- 仕様（docs/spec.md）に書かれていない挙動を決める必要があるとき、「未決事項」に触れるとき、「決定事項」を覆す必要があるとき
- データの送信先・保存先・保存期間が変わるとき

## Git

- コミットメッセージは Conventional Commits（`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`）。本文は日本語可。
- 1 コミット/1 PR は 1 目的。生成物（`.output/`, `.wxt/`）はコミットしない。
