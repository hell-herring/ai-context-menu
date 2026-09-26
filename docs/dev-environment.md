# 開発環境（web 版 Claude Code / web 版 Codex）

web 版 Claude Code と web 版 Codex のどちらで作業しても、同じ版のツール・依存で開発できるようにするための定義と使い方。
環境の構築手順は [`scripts/setup-dev-env.sh`](../scripts/setup-dev-env.sh) にコードとして持ち、両環境からはそれを呼ぶだけにする。

## 1. 揃えるもの

| 対象 | 版の決め方（正） | 取得元 | 置き場所 |
|---|---|---|---|
| Node.js | [`.node-version`](../.node-version) のメジャー版の最新（CI の `actions/setup-node` と同じ決め方） | `https://nodejs.org/dist`（`SHASUMS256.txt` で SHA-256 を検証） | `~/.local/share/ai-context-menu-dev/node-v<版>-linux-<CPU>/` |
| pnpm | `package.json` の `packageManager` | npm レジストリ（上の Node.js の npm でグローバルに導入） | 上の Node.js の `bin/` |
| 依存（`node_modules`） | `pnpm-lock.yaml`（`pnpm install --frozen-lockfile`。postinstall で `wxt prepare`） | npm レジストリ | リポジトリ内 |
| Chromium（E2E 用） | `@playwright/test` の版が想定するもの | `pnpm exec playwright install chromium`（取得できない環境では既存の Chromium。§4） | Playwright の既定の場所 |

- 版はすべてリポジトリ内のファイルから決まる。`.node-version` / `packageManager` / `pnpm-lock.yaml` を更新すれば、次のセットアップで両環境とも追従する。
- 実行は冪等・非対話。揃っているものは取得しないため、2 回目以降は 1 秒未満で終わる（`pnpm install` の確認のみ）。
- 最後に `--check` と同じ検査（Node.js・pnpm の版、依存、Chromium の起動）を行い、Node.js・pnpm・依存が揃っていなければ終了コード 1 で失敗する。Chromium は E2E にだけ使うため、起動できなくても（依存ライブラリを入れられなかった場合も）警告にとどめる。
- 依存の検査はオフラインでも行えるよう pnpm には問い合わせず、このスクリプトで `pnpm install` したときの `package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml` のハッシュ（`node_modules/.aicm-deps.sha256`）と比べ、あわせて pnpm の仮想ストア（`node_modules/.pnpm/lock.yaml`）と `package.json` の直接の依存がすべて `node_modules` にあることを確かめる（各パッケージの中身までは検査しない）。ブランチの切り替えなどでこれらが変わったら、スクリプトを実行し直す（手で `pnpm install` しただけでは `--check` は `NG` のまま）。

```bash
bash scripts/setup-dev-env.sh          # セットアップ（冪等）
bash scripts/setup-dev-env.sh --check  # 何も入れずに検査だけ行う
```

| 環境変数 | 既定値 | 用途 |
|---|---|---|
| `AICM_DEV_HOME` | `~/.local/share/ai-context-menu-dev` | Node.js と `env.sh`（PATH 設定）の置き場所 |
| `AICM_NODE_MIRROR` | `https://nodejs.org/dist` | Node.js の取得元（ミラーを使う場合） |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | なし | 使う Chromium を明示する（`tests/e2e/fixtures.ts` と共通） |

### PATH の反映

セットアップは `$AICM_DEV_HOME/env.sh`（Node.js の `bin` を PATH の先頭に置く。すでに PATH にあれば先頭へ移す。§4 の代替 Chromium を使う場合はその指定も含む）を生成し、次のすべてから読み込ませる。

- `$CLAUDE_ENV_FILE`（Claude Code のフックから実行したとき。以降の Bash ツールの各コマンドの前に読み込まれる）
- `~/.bashrc` と `~/.profile`（あれば `~/.bash_profile` も）の**先頭と末尾**。先頭は、Ubuntu の `~/.bashrc` が非対話シェルでは冒頭で `return` するため。末尾は、途中で nvm 等が別の Node.js を PATH の先頭に入れても最後にこちらを先頭へ戻すため

## 2. 方式の決定

**共通のシェルスクリプト 1 本 + 各環境の薄い入口**にした。

| 候補 | 採否 | 理由 |
|---|---|---|
| 共通シェルスクリプト（採用） | ○ | 両環境とも「Ubuntu のコンテナで任意のシェルスクリプトを実行できる」点だけが共通。追加のツールが要らず、CI（GitHub Actions）でも同じものを検証できる |
| Dockerfile / Dev Container | × | どちらの web 環境も自前のイメージを指定できない（Codex は `codex-universal`、Claude Code は既定のイメージ）。`devcontainer.json` も読まれない |
| nvm / corepack など既存のマネージャ | × | nvm の有無・場所が環境ごとに違う。corepack は Node.js 25 以降に同梱されない |
| mise / asdf など | × | 本体の導入から必要になり、取得元（ホスト）が増える |
| `package.json` の `devEngines.runtime` | × | `pnpm` 自体の導入は別に必要。CI・ローカルの挙動まで変わるため、この Issue の範囲を超える |

入口:

| 環境 | 入口 | リポジトリでの定義 |
|---|---|---|
| web 版 Claude Code | SessionStart フック | [`.claude/settings.json`](../.claude/settings.json) → [`.claude/hooks/session-start.sh`](../.claude/hooks/session-start.sh) → `scripts/setup-dev-env.sh` |
| web 版 Codex | 環境設定の「セットアップスクリプト」「メンテナンススクリプト」 | `bash scripts/setup-dev-env.sh`（設定画面に 1 行書くだけ。§3.2） |
| CI | [`.github/workflows/dev-env.yml`](../.github/workflows/dev-env.yml) | 新しい Ubuntu で 2 回実行 → `--check` → `pnpm check` → E2E |

## 3. 環境ごとの設定

### 3.1 web 版 Claude Code

**環境の設定画面で行うことはない。** リポジトリの `.claude/settings.json` の SessionStart フックが、セッションの開始・再開のたびに `scripts/setup-dev-env.sh` を実行する（既定のブランチにマージ後のセッションから有効）。

- フックは `CLAUDE_CODE_REMOTE=true`（web 版）のときだけ動く。ローカルの Claude Code では何もしない。
- 同期実行（タイムアウト 600 秒）。初回は Node.js・依存の取得で 30 秒前後かかり、終わるまでセッションは始まらない。そのかわり、エージェントが準備前の環境でコマンドを実行することはない。
- ログは標準エラーに出し、標準出力（セッションのコンテキストに入る）には `開発環境: Node.js v26.x / pnpm 12.x` の 1 行だけを出す。
- ネットワーク: `nodejs.org` と `registry.npmjs.org` への HTTPS が必要。環境のネットワーク設定でこれらが許可されていること（プロキシの CA は環境側で `NODE_EXTRA_CA_CERTS` 等に設定済みで、スクリプトでの対応は不要）。

### 3.2 web 版 Codex

Codex の環境設定（Environments）で、このリポジトリに使う環境を開き、次の値を設定して保存する。セットアップ済みのキャッシュが残っている環境には設定変更が反映されないことがあるため、保存後は新しい環境を作成してタスクを開始する。

| 項目 | 値 |
|---|---|
| セットアップスクリプト（Setup script） | `bash scripts/setup-dev-env.sh` |
| メンテナンススクリプト（Maintenance script。キャッシュしたコンテナを再利用するときに実行） | `bash scripts/setup-dev-env.sh` |
| 言語のプリセット（Node.js の版など） | 既定のままでよい（スクリプトが `.node-version` の版を別に入れて PATH の先頭に置く） |
| エージェントのインターネットアクセス | オフのままでよい（必要なものはすべてセットアップで入れる。テストは実 API を呼ばない） |
| 環境変数・シークレット | 不要（API キーは開発・テストで使わない。guardrails.md §5） |

設定画面へ貼り付けるコマンドは、Setup script と Maintenance script のどちらも次の 1 行である。

```bash
bash scripts/setup-dev-env.sh
```

- Setup script は新しいコンテナを作成するとき、Maintenance script はキャッシュ済みコンテナを再利用するときに必要である。片方だけでは、タスクによってセットアップされない場合があるため、**両方に同じコマンドを設定する**。
- セットアップ中に `nodejs.org`、`registry.npmjs.org`、`cdn.playwright.dev` と Ubuntu のパッケージリポジトリへアクセスできることが必要である。Codex のセットアップログで `scripts/setup-dev-env.sh` が終了コード 0 になったことを確認する。
- セットアップスクリプトの `export` はエージェントのシェルに引き継がれないため、PATH は `~/.bashrc` / `~/.profile` 経由で反映する（§1）。
- セットアップはインターネットに出られるため、Playwright の Chromium と依存ライブラリ（root で `apt-get` が使えるとき `playwright install-deps chromium`）も入る。
- エージェント開始後はインターネットアクセスがオフなので、セットアップに失敗したセッション内で `bash scripts/setup-dev-env.sh` を再実行しても Node.js や依存は取得できない。セットアップログを確認して設定を直し、環境を作り直す。開始直後の `node --version` が `.node-version` と違う場合も、セットアップスクリプトが未設定または失敗している。

新しいタスクの開始直後に、次を実行して設定が反映されたことを確認する。

```bash
node --version                              # v26.x
pnpm --version                              # package.json の packageManager と同じ版
bash scripts/setup-dev-env.sh --check       # Node.js・pnpm・依存・Chromium を検査
pnpm check                                  # lint・型検査・単体テスト
pnpm build:e2e && pnpm test:e2e             # E2E 用ビルド・E2E テスト
```

## 4. 制約事項と環境差分

| 項目 | web 版 Claude Code | web 版 Codex | 影響と対処 |
|---|---|---|---|
| 元から入っている Node.js | 22 系など（`/opt/node*`） | イメージのプリセット | 使わない。スクリプトの Node.js を PATH の先頭に置く |
| Playwright の Chromium の取得（`cdn.playwright.dev`） | 既定のネットワーク設定では**遮断される** | セットアップ中は取得できる | Claude Code では `PLAYWRIGHT_BROWSERS_PATH` 配下の既存の Chromium（Playwright の想定より古い版）を `PLAYWRIGHT_CHROMIUM_EXECUTABLE` で使う。2026-09 時点で E2E は全件通る。セットアップのたびに想定版の取得を先に試みる（遮断されている間は数秒余分にかかる）ため、環境のネットワーク設定で `cdn.playwright.dev` に出られるようにすれば、次のセットアップで想定版を取得し、代替は使わなくなる。利用者が自分で `PLAYWRIGHT_CHROMIUM_EXECUTABLE` を指定した場合は、それをそのまま使う（起動できなければ代替には替えずに警告する。正しいパスにするか、未設定にして再実行する） |
| エージェント実行中のネットワーク | 環境のネットワーク設定に従う | 既定でオフ | 依存の追加（`pnpm add`）は Codex ではセットアップ以外でできない。依存を変える作業は Claude Code かローカルで行う |
| 環境変数の反映 | `$CLAUDE_ENV_FILE` | `~/.bashrc` / `~/.profile` | スクリプトが両方に書く |
| Node.js のパッチ版 | 初回セットアップ時点の 26.x の最新 | 同左 | 導入済みの 26.x があれば更新しない。新しいパッチ版にするときは `$AICM_DEV_HOME/node-v*` を削除して再実行する（CI は毎回最新の 26.x） |
| 対応 OS / CPU | Linux x64 / arm64 | 同左 | それ以外ではスクリプトが失敗する |

- どちらの環境でも `pnpm dev`（Chrome を起動する開発サーバー）は使えない（画面がない）。動作確認は `pnpm build:e2e` → `pnpm test:e2e` で行う。
- ローカル（自分の PC）での利用は想定していない（`~/.bashrc` 等を書き換えるため）。ローカルでは `.node-version` を読めるバージョンマネージャ（fnm・mise など）で Node.js を入れ、pnpm は `npm i -g pnpm@<packageManager の版>` で入れる（Node.js 26 には corepack が同梱されない）。

## 5. 確認方法

- `bash scripts/setup-dev-env.sh --check` がすべて `OK` になること（Chromium は `WARN` の場合 E2E が動かない）。
- CI の `Dev environment` ワークフロー（関係するファイルを変えた PR と main への push で実行）が、何も入っていない Ubuntu からの再現・冪等性・`pnpm check`・E2E を検証する。
- 新しい環境を作ったら、上の `--check` に加えて `pnpm check` と `pnpm build:e2e && pnpm test:e2e` を実行する。
