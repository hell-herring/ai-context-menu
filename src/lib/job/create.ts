import { escapedTextLength, truncateToEscapedLength } from "../prompt/escape";
import type { PresetId } from "../prompt/presets";
import {
  type ExtractMethod,
  JOB_LIMITS,
  type Job,
  type JobErrorCode,
  type JobSource,
  type OversizeReason,
  type SourceType,
} from "../storage/schema";

/** 1 ジョブを JSON 化した UTF-8 バイト数の上限（docs/tech-stack.md §4.2 手順 8） */
export const MAX_JOB_BYTES = 2 * 1024 * 1024;

/** 抽出スクリプトなどから得た、切り詰め前のコンテンツ */
export interface ExtractedContent {
  type: SourceType;
  method: ExtractMethod;
  title: string;
  url: string;
  text: string;
  /** 抽出側で打ち切る前の本文の文字数 */
  originalLength: number;
}

/** ジョブの共通部分（クリック時に決まる値） */
export interface JobContext {
  id: string;
  windowId: number;
  seq: number;
  createdAt: number;
  presetId: PresetId;
  pageUrl: string;
  frameUrl?: string | undefined;
}

/**
 * プロバイダへ送る URL。ユーザー情報・クエリ・フラグメントを除いた origin + pathname のみ（docs/spec.md §3.2）。
 * http(s) 以外（file: 等。パスにユーザー名を含みうる）や不正な URL は送らない（空文字）。
 */
export function toProviderUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "";
  }
  return `${parsed.origin}${parsed.pathname}`;
}

/**
 * 抽出結果をジョブの `source` に変換する。本文が空なら undefined。
 *
 * 上限を超える値は黙って短縮せず、短縮したうえで `oversize` とその理由を記録する
 * （サイドパネルは oversize のジョブを必ずユーザー確認に回す。docs/tech-stack.md §4.2 手順 6）。
 * 本文の上限は XML エスケープ後の文字数で判定する。
 */
export function createJobSource(
  content: ExtractedContent,
  maxInputChars: number,
): JobSource | undefined {
  if (content.text.trim() === "") {
    return undefined;
  }

  const reasons = new Set<OversizeReason>();
  const limit = (value: string, max: number): string => {
    if (value.length <= max) {
      return value;
    }
    reasons.add("metadata");
    return value.slice(0, max);
  };

  const title = limit(content.title, JOB_LIMITS.title);
  const displayUrl = limit(content.url, JOB_LIMITS.displayUrl);
  const providerUrl = limit(toProviderUrl(content.url), JOB_LIMITS.providerUrl);

  let text = content.text;
  const originalLength = Math.max(content.originalLength, content.text.length);
  if (originalLength > content.text.length || escapedTextLength(text) > maxInputChars) {
    reasons.add("content");
    text = truncateToEscapedLength(text, maxInputChars);
  }

  return {
    type: content.type,
    method: content.method,
    title,
    displayUrl,
    providerUrl,
    text,
    originalLength,
    inputLimit: maxInputChars,
    oversize: reasons.size > 0,
    oversizeReasons: [...reasons],
  };
}

export function createContentJob(context: JobContext, source: JobSource): Job {
  return { ...jobBase(context), kind: "content", source };
}

export function createErrorJob(context: JobContext, error: JobErrorCode): Job {
  return { ...jobBase(context), kind: "error", error };
}

function jobBase(context: JobContext): JobContext {
  const base: JobContext = {
    id: context.id,
    windowId: context.windowId,
    seq: context.seq,
    createdAt: context.createdAt,
    presetId: context.presetId,
    pageUrl: context.pageUrl.slice(0, JOB_LIMITS.displayUrl),
  };
  if (context.frameUrl !== undefined) {
    base.frameUrl = context.frameUrl.slice(0, JOB_LIMITS.displayUrl);
  }
  return base;
}

/** ジョブを JSON 化した UTF-8 バイト数 */
export function jobByteSize(job: Job): number {
  return new TextEncoder().encode(JSON.stringify(job)).length;
}
