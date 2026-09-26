#!/usr/bin/env bash
# 開発環境のセットアップ（web 版 Claude Code / web 版 Codex で共通）。
#
# - Node.js: .node-version のメジャー版の最新を nodejs.org から取得し、SHA-256 を検証して
#   $AICM_DEV_HOME（既定 ~/.local/share/ai-context-menu-dev）に展開する
# - pnpm: package.json の packageManager と同じ版を、上記 Node.js の npm でグローバルに入れる
#   （Node.js 25 以降は corepack が同梱されないため）
# - 依存: pnpm install --frozen-lockfile（postinstall で wxt prepare）
# - E2E: Playwright の Chromium（起動できないときは、root か sudo で apt-get が使えれば依存ライブラリも入れる）
# - PATH: $CLAUDE_ENV_FILE（Claude Code）と ~/.bashrc・~/.profile（Codex など）から env.sh を読み込ませ、
#   以降のシェルで上記の Node.js / pnpm が使われるようにする
#
# 冪等（何度実行してもよい）・非対話。すでに揃っているものは取得しない。
# 使い方: bash scripts/setup-dev-env.sh [--check]
#   --check  何も入れずに、環境が揃っているかだけを検査する（揃っていなければ終了コード 1）
# 詳細は docs/dev-environment.md。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_HOME="${AICM_DEV_HOME:-$HOME/.local/share/ai-context-menu-dev}"
NODE_MIRROR="${AICM_NODE_MIRROR:-https://nodejs.org/dist}"
ENV_SCRIPT="$DEV_HOME/env.sh"
PROFILE_MARKER="# ai-context-menu dev env"
CHROMIUM_FALLBACK_MARKER="# chromium-fallback:"
# 依存を入れたときの package.json / pnpm-lock.yaml / pnpm-workspace.yaml のハッシュ（node_modules を消せば一緒に消える）
DEPS_STAMP="$ROOT_DIR/node_modules/.aicm-deps.sha256"

MODE="setup"
case "${1:-}" in
  "") ;;
  --check) MODE="check" ;;
  *)
    echo "usage: $0 [--check]" >&2
    exit 2
    ;;
esac

TMP_DIRS=()
cleanup() { [[ ${#TMP_DIRS[@]} -eq 0 ]] || rm -rf "${TMP_DIRS[@]}"; }
trap cleanup EXIT

log() { echo "[setup-dev-env] $*" >&2; }
fail() {
  log "ERROR: $*"
  exit 1
}

NODE_MAJOR="$(tr -d '[:space:]v' <"$ROOT_DIR/.node-version")"
[[ "$NODE_MAJOR" =~ ^[0-9]+$ ]] || fail ".node-version はメジャー版の数字だけを書く想定です: $NODE_MAJOR"
PNPM_VERSION="$(sed -n 's/.*"packageManager": *"pnpm@\([^"+]*\).*/\1/p' "$ROOT_DIR/package.json")"
[[ -n "$PNPM_VERSION" ]] || fail "package.json の packageManager から pnpm の版を読めません"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) NODE_PLATFORM="linux-x64" ;;
  Linux-aarch64 | Linux-arm64) NODE_PLATFORM="linux-arm64" ;;
  *) fail "未対応の OS/CPU です: $(uname -s)-$(uname -m)（Linux x64 / arm64 のみ）" ;;
esac

# 入れた依存が消えていないか（pnpm の仮想ストアと、package.json の直接の依存、推移的な依存がすべてあるか）。
# 推移的な依存は、直接の依存から仮想ストア（node_modules/.pnpm/<パッケージ>/node_modules/）のリンクをたどり、
# どれも実在する package.json を指すかで確かめる（依存が消えるとリンク切れになる。どこからも参照されない項目は見ない）。
# オフラインで確かめられる範囲にとどめる（各パッケージの中身までは検査しない）
deps_installed() {
  [[ -f "$ROOT_DIR/node_modules/.pnpm/lock.yaml" ]] || return 1
  (cd "$ROOT_DIR" && node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
    const missing = names.filter((name) => !fs.existsSync("node_modules/" + name + "/package.json"));
    if (missing.length > 0) {
      console.error("見つからない依存: " + missing.join(" "));
      process.exit(1);
    }
    // 直接の依存から仮想ストアのリンクをたどる（前の版の残りなど、どこからも参照されない項目は検査しない）。
    // 実体は node_modules/.pnpm/<項目>/node_modules/<名前> にあり、同じ node_modules に並ぶものがその依存
    const children = (dir) =>
      fs
        .readdirSync(dir)
        .filter((name) => !name.startsWith("."))
        .flatMap((name) => (name.startsWith("@") ? children(path.join(dir, name)).map((sub) => path.join(name, sub)) : [name]));
    const visited = new Set();
    const broken = [];
    const queue = names.map((name) => fs.realpathSync("node_modules/" + name));
    while (queue.length > 0) {
      const real = queue.pop();
      const match = /^(.*\/node_modules\/\.pnpm\/[^/]+\/node_modules)\//.exec(real);
      if (!match || visited.has(match[1])) continue;
      visited.add(match[1]);
      for (const name of children(match[1])) {
        const dep = path.join(match[1], name);
        if (fs.existsSync(path.join(dep, "package.json"))) queue.push(fs.realpathSync(dep));
        else broken.push(path.relative(process.cwd(), dep));
      }
    }
    if (broken.length > 0) {
      console.error("仮想ストアに欠けた依存があります: " + broken.slice(0, 5).join(" ") + (broken.length > 5 ? " ほか " + (broken.length - 5) + " 件" : ""));
      process.exit(1);
    }
  ' 2>&1 | sed 's/^/[setup-dev-env]      /' >&2; exit "${PIPESTATUS[0]}")
}

deps_hash() {
  cat "$ROOT_DIR/package.json" "$ROOT_DIR/pnpm-lock.yaml" "$ROOT_DIR/pnpm-workspace.yaml" | sha256sum | cut -d " " -f 1
}

deps_current() {
  [[ -f "$DEPS_STAMP" && "$(cat "$DEPS_STAMP")" == "$(deps_hash)" && -d "$ROOT_DIR/.wxt" ]] && deps_installed
}

node_major_of() { "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || true; }

# 展開済みの Node.js（最も新しいもの）の bin ディレクトリ。なければ空
installed_node_bin() {
  local dir
  dir="$(find "$DEV_HOME" -maxdepth 1 -type d -name "node-v${NODE_MAJOR}.*-${NODE_PLATFORM}" 2>/dev/null | sort -V | tail -n 1)"
  if [[ -n "$dir" && -x "$dir/bin/node" && "$(node_major_of "$dir/bin/node")" == "$NODE_MAJOR" ]]; then
    echo "$dir/bin"
  fi
}

install_node() {
  local shasums file version url tmp name
  log "Node.js ${NODE_MAJOR}.x の最新版を ${NODE_MIRROR} から取得します"
  if ! shasums="$(curl -fsSL --retry 3 "$NODE_MIRROR/latest-v${NODE_MAJOR}.x/SHASUMS256.txt")"; then
    fail "Node.js の版情報を取得できません。Codex ではセットアップ/メンテナンススクリプトとして実行し、失敗後は環境を再作成してください（docs/dev-environment.md §3.2）"
  fi
  file="$(awk -v p="$NODE_PLATFORM" '$2 ~ "^node-v[0-9.]+-" p "\\.tar\\.gz$" { print $2 }' <<<"$shasums" | head -n 1)"
  [[ -n "$file" ]] || fail "SHASUMS256.txt に ${NODE_PLATFORM} の tar.gz がありません"
  version="${file#node-}"
  version="${version%%-*}"
  url="$NODE_MIRROR/$version/$file"
  tmp="$(mktemp -d)"
  TMP_DIRS+=("$tmp")
  if ! curl -fsSL --retry 3 -o "$tmp/$file" "$url"; then
    fail "Node.js を取得できません: $url（ネットワーク設定と AICM_NODE_MIRROR を確認してください）"
  fi
  (cd "$tmp" && awk -v f="$file" '$2 == f' <<<"$shasums" | sha256sum -c --quiet -) ||
    fail "Node.js の SHA-256 が一致しません: $url"
  name="${file%.tar.gz}"
  mkdir -p "$DEV_HOME"
  tar -xzf "$tmp/$file" -C "$tmp"
  rm -rf "${DEV_HOME:?}/${name:?}"
  mv "$tmp/$name" "$DEV_HOME/"
  log "Node.js $version を $DEV_HOME/$name に展開しました"
}

# env.sh を書く。Chromium の代替（下記 install_chromium）を使う場合は PLAYWRIGHT_CHROMIUM_EXECUTABLE も書く
write_env_script() {
  mkdir -p "$DEV_HOME"
  {
    echo "# scripts/setup-dev-env.sh が生成（手で編集しない）。~/.profile から sh でも読まれるため POSIX sh で書く"
    echo "# 他のマネージャ（nvm 等）が先に PATH へ入れた Node.js より優先されるよう、既存の位置から外して先頭に置く"
    echo "_aicm_path=\"\""
    echo "_aicm_ifs=\$IFS"
    echo "IFS=:"
    echo "for _aicm_dir in \$PATH; do"
    echo "  [ \"\$_aicm_dir\" = \"$NODE_BIN\" ] || _aicm_path=\"\${_aicm_path:+\$_aicm_path:}\$_aicm_dir\""
    echo "done"
    echo "IFS=\$_aicm_ifs"
    echo "export PATH=\"$NODE_BIN\${_aicm_path:+:\$_aicm_path}\""
    echo "unset _aicm_path _aicm_ifs _aicm_dir"
    if [[ -n "$CHROMIUM_FALLBACK" ]]; then
      echo "$CHROMIUM_FALLBACK_MARKER $CHROMIUM_FALLBACK"
      echo "export PLAYWRIGHT_CHROMIUM_EXECUTABLE=\"\${PLAYWRIGHT_CHROMIUM_EXECUTABLE:-$CHROMIUM_FALLBACK}\""
    fi
  } >"$ENV_SCRIPT"
}

# ~/.bashrc・~/.profile（あれば ~/.bash_profile）の先頭と末尾で env.sh を読み込ませる。
# - 先頭: Ubuntu の ~/.bashrc は非対話シェルだと冒頭の return で読み込みを打ち切るため
# - 末尾: 途中で nvm 等が PATH の先頭に別の Node.js を入れても、最後にこちらを先頭へ戻すため
# 既存の行（マーカー付き）は消してから入れ直すので、何度実行しても同じ内容になる
persist_to_profiles() {
  local line="[ -f \"$ENV_SCRIPT\" ] && . \"$ENV_SCRIPT\" $PROFILE_MARKER"
  local rc body
  # ~/.bash_profile があるとログインシェルは ~/.profile を読まないため、あればそちらにも入れる
  for rc in "$HOME/.bashrc" "$HOME/.profile" "$HOME/.bash_profile"; do
    if [[ ! -f "$rc" ]]; then
      [[ "$rc" == "$HOME/.bash_profile" ]] && continue
      touch "$rc"
    fi
    body="$(grep -vF "$PROFILE_MARKER" "$rc" || true)"
    if [[ "$(cat "$rc")" != "$(printf '%s\n%s\n%s' "$line" "$body" "$line")" ]]; then
      printf '%s\n%s\n%s\n' "$line" "$body" "$line" >"$rc"
      log "$rc に PATH の設定を入れました"
    fi
  done
  if [[ -n "${CLAUDE_ENV_FILE:-}" ]]; then
    if ! grep -qF "$ENV_SCRIPT" "$CLAUDE_ENV_FILE" 2>/dev/null; then
      echo ". \"$ENV_SCRIPT\"" >>"$CLAUDE_ENV_FILE"
    fi
  fi
}

# Playwright が使う Chromium の実行ファイル（PLAYWRIGHT_CHROMIUM_EXECUTABLE を優先）
chromium_executable() {
  if [[ -n "${PLAYWRIGHT_CHROMIUM_EXECUTABLE:-}" ]]; then
    echo "$PLAYWRIGHT_CHROMIUM_EXECUTABLE"
    return
  fi
  (cd "$ROOT_DIR" && node -e 'console.log(require("@playwright/test").chromium.executablePath())' 2>/dev/null) || true
}

chromium_works() {
  local exe
  exe="$(chromium_executable)"
  [[ -n "$exe" && -x "$exe" ]] && "$exe" --headless --no-sandbox --version >/dev/null 2>&1
}

can_install_os_deps() {
  command -v apt-get >/dev/null 2>&1 && { [[ "$(id -u)" == "0" ]] || sudo -n true 2>/dev/null; }
}

# 既存の Chromium（PLAYWRIGHT_BROWSERS_PATH 配下の最も新しいもの）。なければ空
existing_chromium() {
  [[ -n "${PLAYWRIGHT_BROWSERS_PATH:-}" && -d "$PLAYWRIGHT_BROWSERS_PATH" ]] || return 0
  find "$PLAYWRIGHT_BROWSERS_PATH" -mindepth 3 -maxdepth 3 -type f -name chrome -path "*/chromium-*/chrome-linux*/chrome" 2>/dev/null |
    sort -V | tail -n 1
}

# 使う Chromium の代替（env.sh に書く）を変え、この実行中の PLAYWRIGHT_CHROMIUM_EXECUTABLE にも反映する
set_chromium_fallback() {
  CHROMIUM_FALLBACK="$1"
  write_env_script
  if [[ -n "$CHROMIUM_FALLBACK" ]]; then
    export PLAYWRIGHT_CHROMIUM_EXECUTABLE="$CHROMIUM_FALLBACK"
  else
    unset PLAYWRIGHT_CHROMIUM_EXECUTABLE
  fi
}

install_chromium() {
  # 利用者が自分で指定した Chromium（前回の代替とは別のもの）はそのまま使う。起動できなくても代替には替えない
  # （env.sh は利用者の指定を上書きしないため、代替を選んでも以降のシェルでは指定したパスが使われてしまう）
  if [[ -n "$USER_CHROMIUM" ]]; then
    set_chromium_fallback ""
    export PLAYWRIGHT_CHROMIUM_EXECUTABLE="$USER_CHROMIUM"
    chromium_works ||
      log "WARN 指定された PLAYWRIGHT_CHROMIUM_EXECUTABLE（$USER_CHROMIUM）が起動できません。正しいパスにするか、未設定にして再実行してください"
    return 0
  fi
  # 前回の代替があっても、Playwright の想定版を毎回優先する（取得できるようになったら代替をやめる）
  if PLAYWRIGHT_CHROMIUM_EXECUTABLE="" chromium_works; then
    set_chromium_fallback ""
    return 0
  fi
  log "Playwright の Chromium を取得します（pnpm exec playwright install chromium）"
  # PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD は postinstall 用の指定なので、明示的な取得では外す
  if (cd "$ROOT_DIR" && env -u PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD pnpm exec playwright install chromium >&2); then
    if ! PLAYWRIGHT_CHROMIUM_EXECUTABLE="" chromium_works && can_install_os_deps; then
      log "Chromium の依存ライブラリを入れます（pnpm exec playwright install-deps chromium）"
      # apt のリポジトリに出られない等で失敗しても、セットアップは止めずに下の代替を探す
      (cd "$ROOT_DIR" && pnpm exec playwright install-deps chromium >&2) ||
        log "WARN Chromium の依存ライブラリを入れられませんでした"
    fi
    if PLAYWRIGHT_CHROMIUM_EXECUTABLE="" chromium_works; then
      set_chromium_fallback ""
      return 0
    fi
  fi
  # 取得できない（ネットワークポリシーで cdn.playwright.dev が許可されていない等）ときは、
  # 環境に入っている Chromium を PLAYWRIGHT_CHROMIUM_EXECUTABLE で使う（tests/e2e/fixtures.ts）
  local fallback
  fallback="$(existing_chromium)"
  if [[ -n "$fallback" ]] && PLAYWRIGHT_CHROMIUM_EXECUTABLE="$fallback" chromium_works; then
    log "WARN Playwright の Chromium を取得できないため、既存の $fallback を使います（Playwright の想定版と異なる）"
    set_chromium_fallback "$fallback"
    return 0
  fi
  set_chromium_fallback ""
  log "WARN Chromium を用意できませんでした。E2E（pnpm test:e2e）は実行できません"
}

check() {
  local ok=0 node_version pnpm_version pnpm_path managed_bin
  node_version="$(node --version 2>/dev/null || echo none)"
  # 管理外の pnpm（corepack のシムなど）は --version でも packageManager の版を取得しに行くことがあるため、
  # このスクリプトで入れた pnpm のときだけ実行する
  pnpm_path="$(command -v pnpm || true)"
  managed_bin="$(installed_node_bin)"
  if [[ -n "$managed_bin" && "$pnpm_path" == "$managed_bin/pnpm" ]]; then
    pnpm_version="$(pnpm --version 2>/dev/null || echo none)"
  else
    pnpm_version="${pnpm_path:+管理外（$pnpm_path）}"
    pnpm_version="${pnpm_version:-none}"
  fi
  if [[ "$node_version" == "v${NODE_MAJOR}."* ]]; then
    log "OK   Node.js $node_version"
  else
    log "NG   Node.js $node_version（${NODE_MAJOR}.x が必要）"
    ok=1
  fi
  if [[ "$pnpm_version" == "$PNPM_VERSION" ]]; then
    log "OK   pnpm $pnpm_version"
  else
    log "NG   pnpm $pnpm_version（$PNPM_VERSION が必要）"
    ok=1
  fi
  # オフライン（Codex のエージェント実行中など）でも検査できるよう、pnpm には問い合わせず、
  # このスクリプトで入れたときの package.json / pnpm-lock.yaml / pnpm-workspace.yaml と比べる
  if deps_current; then
    log "OK   依存（pnpm-lock.yaml と一致）"
  else
    log "NG   依存が未導入・欠けている、または package.json / pnpm-lock.yaml の変更後に入れ直していません（bash scripts/setup-dev-env.sh）"
    ok=1
  fi
  # Chromium は E2E にだけ使うため、なくても失敗にはしない（環境のセットアップ自体は止めない）
  if chromium_works; then
    log "OK   Chromium $(chromium_executable)"
  else
    log "WARN Chromium が起動できません。E2E（pnpm test:e2e）は実行できません"
  fi
  return "$ok"
}

if [[ "$MODE" == "setup" ]]; then
  NODE_BIN="$(installed_node_bin)"
  if [[ -z "$NODE_BIN" ]]; then
    install_node
    NODE_BIN="$(installed_node_bin)"
    [[ -n "$NODE_BIN" ]] || fail "展開した Node.js が見つかりません"
  fi
  # 前回使った Chromium の代替を読む（使い続けるかは install_chromium で毎回決め直す）
  CHROMIUM_FALLBACK=""
  if [[ -f "$ENV_SCRIPT" ]] && grep -qF "$CHROMIUM_FALLBACK_MARKER" "$ENV_SCRIPT"; then
    CHROMIUM_FALLBACK="$(sed -n "s|^$CHROMIUM_FALLBACK_MARKER ||p" "$ENV_SCRIPT")"
  fi
  # 利用者が自分で指定した Chromium（env.sh を読む前の値。前回の代替と同じなら env.sh 由来なので除く）
  USER_CHROMIUM="${PLAYWRIGHT_CHROMIUM_EXECUTABLE:-}"
  [[ "$USER_CHROMIUM" != "$CHROMIUM_FALLBACK" ]] || USER_CHROMIUM=""
  write_env_script
  persist_to_profiles
fi

# 以降は（setup でも check でも）この環境の Node.js / pnpm を使う
if [[ -f "$ENV_SCRIPT" ]]; then
  # shellcheck source=/dev/null
  . "$ENV_SCRIPT"
fi

if [[ "$MODE" == "setup" ]]; then
  # 管理外の pnpm は実行しない（上の check と同じ理由）ため、場所を先に確かめてから版を見る
  if [[ "$(command -v pnpm || true)" != "$NODE_BIN/pnpm" ]] || [[ "$(pnpm --version 2>/dev/null || true)" != "$PNPM_VERSION" ]]; then
    log "pnpm@$PNPM_VERSION を入れます"
    npm install --global --no-fund --no-audit --no-update-notifier "pnpm@$PNPM_VERSION" >&2
  fi
  if deps_current; then
    log "依存は導入済みです（pnpm install を省略）"
  else
    log "依存を入れます（pnpm install --frozen-lockfile）"
    (cd "$ROOT_DIR" && pnpm install --frozen-lockfile >&2)
    deps_hash >"$DEPS_STAMP"
  fi
  install_chromium
fi

check
