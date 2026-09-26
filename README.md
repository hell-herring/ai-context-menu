# ai-context-menu

右クリックで、選択テキストやページ本文を AI（Claude / ChatGPT など）に要約させる Chrome 拡張機能。

> **ステータス: 開発中（M0: 雛形まで）。** 右クリックメニューから空のサイドパネルが開く段階で、要約機能はまだ動きません。

## 特徴（予定）

- 右クリック → 「要約する / 3行で要約 / 要点を箇条書き」
- 結果はサイドパネルにストリーミング表示（停止・再生成・コピー）
- Anthropic（Claude）/ OpenAI（ChatGPT）を切り替え可能。自分の API キーを使用（BYOK）
- 自前サーバーなし・テレメトリなし。送信先はユーザーが選んだ AI プロバイダのみ
- 除外ドメイン設定、送信内容の表示、入力上限時の確認

## インストール

Chrome ウェブストアでは公開しません。ビルドして手動で読み込みます。

1. Node.js 24 と pnpm を用意し、`pnpm install && pnpm build`
2. `chrome://extensions` を開き「デベロッパー モード」を有効化
3. 「パッケージ化されていない拡張機能を読み込む」で `.output/chrome-mv3` を選択

## 開発

```bash
pnpm dev     # 拡張を読み込んだ Chrome を起動（HMR）
pnpm check   # lint + typecheck + test
```

コマンドの一覧と規約は [AGENTS.md](./AGENTS.md) を参照。

## ドキュメント

- [機能仕様](./docs/spec.md)
- [技術選定とアーキテクチャ](./docs/tech-stack.md)
- [ガードレール](./docs/guardrails.md)
- [AGENTS.md](./AGENTS.md)（AI コーディングエージェント向けコンテキスト。`CLAUDE.md` から参照）

## ライセンス

[MIT](./LICENSE)
