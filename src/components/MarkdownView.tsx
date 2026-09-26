import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { isSafeLinkUrl } from "../lib/safe-url";

// AI の出力は信頼できないデータとして扱う（docs/guardrails.md §3.2）。
// - 生 HTML は描画しない（skipHtml。rehype-raw は使わない）
// - リンクは http(s) のみ、新しいタブで noopener noreferrer で開く
// - 画像は自動で読み込まず、リンクに置き換える（外部への情報漏えい経路になるため）
const components: Components = {
  a: ({ href, children }) =>
    isSafeLinkUrl(href) ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ src, alt }) =>
    isSafeLinkUrl(src) ? (
      <a href={src} target="_blank" rel="noopener noreferrer">
        {alt || src}
      </a>
    ) : (
      <span>{alt}</span>
    ),
};

export function MarkdownView({ text }: { text: string }) {
  return (
    <div className="markdown">
      <Markdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {text}
      </Markdown>
    </div>
  );
}
