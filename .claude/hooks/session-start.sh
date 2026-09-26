#!/usr/bin/env bash
# web 版 Claude Code のセッション開始時に開発環境を揃える（ローカルの Claude Code では何もしない）。
# 中身は web 版 Codex と共通の scripts/setup-dev-env.sh。詳細は docs/dev-environment.md。
set -euo pipefail

if [[ "${CLAUDE_CODE_REMOTE:-}" != "true" ]]; then
  exit 0
fi

# 標準出力はセッションのコンテキストに入るため、セットアップのログは標準エラーに出し、結果だけを出力する
bash "$CLAUDE_PROJECT_DIR/scripts/setup-dev-env.sh"
# shellcheck source=/dev/null
. "${AICM_DEV_HOME:-$HOME/.local/share/ai-context-menu-dev}/env.sh"
echo "開発環境: Node.js $(node --version) / pnpm $(pnpm --version)（scripts/setup-dev-env.sh で準備済み）"
