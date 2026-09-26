// 除外ドメインの判定（docs/spec.md §3.1・§3.6）。
// パターンは `example.com`（そのホストのみ）または `*.example.com`（example.com とそのサブドメイン）。

/** 除外ドメインの最大件数（storage.sync の容量制限のため。docs/tech-stack.md §3） */
export const MAX_EXCLUDED_DOMAINS = 200;

const WILDCARD_PREFIX = "*.";

/** ホスト名として受け付けない文字（URL の区切り文字・ワイルドカードの途中使用・空白） */
const INVALID_HOST_CHARS = /[\s/\\:?#@*%[\]]/;

const IPV4 = /^\d+\.\d+\.\d+\.\d+$/;

/** 別の URL を埋め込むスキーム（オリジンが "null" になるため、埋め込まれた URL のホストで判定する） */
export const WRAPPER_PROTOCOLS: ReadonlySet<string> = new Set(["view-source:", "filesystem:"]);

/**
 * 入力されたパターンを正規化する（小文字化・IDN の Punycode 化・末尾のドットの除去）。不正なら undefined。
 * `https://example.com/path` のような URL を貼り付けた場合はホスト名を取り出す。
 */
export function normalizeDomainPattern(input: string): string | undefined {
  let value = input.trim().toLowerCase();
  if (/^[a-z][a-z\d+.-]*:\/\//.test(value)) {
    const hostname = parseHostname(value);
    if (hostname === undefined) {
      return undefined;
    }
    value = hostname;
  }

  const wildcard = value.startsWith(WILDCARD_PREFIX);
  const host = wildcard ? value.slice(WILDCARD_PREFIX.length) : value;
  if (host === "" || INVALID_HOST_CHARS.test(host)) {
    return undefined;
  }
  const hostname = parseHostname(`http://${host}/`);
  if (hostname === undefined || hostname === "" || hostname.startsWith(".")) {
    return undefined;
  }
  // IP アドレスにワイルドカードは付けられない
  if (wildcard && IPV4.test(hostname)) {
    return undefined;
  }
  return wildcard ? `${WILDCARD_PREFIX}${hostname}` : hostname;
}

/** 1 行 1 パターンのテキストを解釈する。重複は除き、解釈できない行は `invalid` に入れる */
export function parseDomainList(text: string): { domains: string[]; invalid: string[] } {
  const domains = new Set<string>();
  const invalid: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") {
      continue;
    }
    const pattern = normalizeDomainPattern(line);
    if (pattern === undefined) {
      invalid.push(line.trim());
    } else {
      domains.add(pattern);
    }
  }
  return { domains: [...domains], invalid };
}

/**
 * URL のホスト名。`blob:` は内側の URL のオリジン、`view-source:` / `filesystem:` は埋め込まれた URL で判定する。
 * ホスト名を持たない URL（`file:` / `about:blank` 等）や不正な URL は undefined。
 */
export function urlHostname(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (WRAPPER_PROTOCOLS.has(parsed.protocol)) {
    return urlHostname(url.slice(parsed.protocol.length));
  }
  const origin = parsed.origin;
  const hostname = origin === "null" ? parsed.hostname : parseHostname(origin);
  return hostname ? hostname.replace(/\.$/, "") : undefined;
}

export function matchesDomainPattern(hostname: string, pattern: string): boolean {
  if (pattern.startsWith(WILDCARD_PREFIX)) {
    const base = pattern.slice(WILDCARD_PREFIX.length);
    return hostname === base || hostname.endsWith(`.${base}`);
  }
  return hostname === pattern;
}

export function isExcludedHostname(hostname: string, patterns: readonly string[]): boolean {
  return hostname !== "" && patterns.some((pattern) => matchesDomainPattern(hostname, pattern));
}

export function isExcludedUrl(url: string, patterns: readonly string[]): boolean {
  const hostname = urlHostname(url);
  return hostname !== undefined && isExcludedHostname(hostname, patterns);
}

/**
 * トップレベルのページ URL とクリックされたフレームの URL のどちらかが除外ドメインに一致するか
 * （除外サイトが iframe で埋め込まれている場合の漏れを防ぐ。docs/spec.md §3.1）
 */
export function isExcludedPage(
  urls: { pageUrl: string; frameUrl?: string | undefined },
  patterns: readonly string[],
): boolean {
  return (
    isExcludedUrl(urls.pageUrl, patterns) ||
    (urls.frameUrl !== undefined && isExcludedUrl(urls.frameUrl, patterns))
  );
}

function parseHostname(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/\.$/, "");
  } catch {
    return undefined;
  }
}
