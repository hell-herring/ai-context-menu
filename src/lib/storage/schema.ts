import { z } from "zod";
import { MAX_EXCLUDED_DOMAINS } from "../domain/exclude";
import { PRESET_IDS } from "../prompt/presets";

// ストレージに置く値のスキーマ。読み出した値は必ずここで検証してから使う（docs/guardrails.md §5）

// ---------------------------------------------------------------------------
// 設定（storage.sync `settings.core`）
// ---------------------------------------------------------------------------

export const OUTPUT_LANGUAGES = ["browser", "ja", "en", "source"] as const;

export type OutputLanguage = (typeof OUTPUT_LANGUAGES)[number];

export const CoreSettingsSchema = z.object({
  version: z.literal(1),
  models: z.object({
    anthropic: z.string().trim().min(1).max(200),
  }),
  outputLanguage: z.enum(OUTPUT_LANGUAGES),
  /** 送信する本文の上限（XML エスケープ後の文字数） */
  maxInputChars: z.int().min(1_000).max(500_000),
  maxOutputTokens: z.int().min(256).max(32_000),
});

export type CoreSettings = z.infer<typeof CoreSettingsSchema>;

// ---------------------------------------------------------------------------
// 除外ドメイン（storage.sync `settings.excludedDomains`）。増えうる一覧なので core とは別キー
// ---------------------------------------------------------------------------

export const ExcludedDomainsSchema = z.object({
  version: z.literal(1),
  /** 正規化済みのパターン（`example.com` / `*.example.com`） */
  domains: z.array(z.string().min(1).max(255)).max(MAX_EXCLUDED_DOMAINS),
});

export type ExcludedDomains = z.infer<typeof ExcludedDomainsSchema>;

// ---------------------------------------------------------------------------
// 要約ジョブ（storage.session `job.<windowId>`）。docs/tech-stack.md §4.2
// ---------------------------------------------------------------------------

/** ジョブに載せるメタデータの上限（docs/tech-stack.md §4.2 手順 6） */
export const JOB_LIMITS = {
  title: 300,
  providerUrl: 2_048,
  displayUrl: 4_096,
} as const;

export const SOURCE_TYPES = ["page", "selection"] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

/** 取得方法。readability / text はページ本文、selection は選択テキスト */
export const EXTRACT_METHODS = ["readability", "text", "selection"] as const;

export type ExtractMethod = (typeof EXTRACT_METHODS)[number];

export const OVERSIZE_REASONS = ["content", "metadata"] as const;

export type OversizeReason = (typeof OVERSIZE_REASONS)[number];

/** background がサイドパネルに渡すエラーの種類。表示文言はサイドパネル側で i18n する */
export const JOB_ERROR_CODES = [
  /** 入力欄・contenteditable 内でのクリック */
  "editable",
  /** chrome:// 等、拡張から読み取れないページ */
  "unreadablePage",
  /** 除外ドメインに一致するページ・フレーム */
  "excludedDomain",
  /** 要約するテキストがない */
  "emptyContent",
  /** ジョブが大きすぎて受け渡せない */
  "tooLarge",
] as const;

export type JobErrorCode = (typeof JOB_ERROR_CODES)[number];

const JobBaseSchema = z.object({
  id: z.uuid(),
  windowId: z.int().nonnegative(),
  /** ウィンドウごとのクリック連番。古いクリックのジョブを判別する */
  seq: z.int().positive(),
  createdAt: z.number().nonnegative(),
  presetId: z.enum(PRESET_IDS),
  /** 除外判定用（プロバイダには送らない） */
  pageUrl: z.string().max(JOB_LIMITS.displayUrl),
  frameUrl: z.string().max(JOB_LIMITS.displayUrl).optional(),
});

export const JobSourceSchema = z.object({
  type: z.enum(SOURCE_TYPES),
  method: z.enum(EXTRACT_METHODS),
  title: z.string().max(JOB_LIMITS.title),
  /** サイドパネルの表示用（ローカルのみ） */
  displayUrl: z.string().max(JOB_LIMITS.displayUrl),
  /** プロバイダへ送る URL（origin + pathname のみ）。取得できなければ空 */
  providerUrl: z.string().max(JOB_LIMITS.providerUrl),
  /** 送信候補の本文。oversize の場合は上限まで切り詰め済み */
  text: z.string(),
  /** 切り詰め前の本文の文字数 */
  originalLength: z.int().nonnegative(),
  /** ジョブ作成時の本文の上限（XML エスケープ後の文字数） */
  inputLimit: z.int().positive(),
  oversize: z.boolean(),
  oversizeReasons: z.array(z.enum(OVERSIZE_REASONS)),
});

export type JobSource = z.infer<typeof JobSourceSchema>;

export const JobSchema = z.discriminatedUnion("kind", [
  JobBaseSchema.extend({ kind: z.literal("content"), source: JobSourceSchema }),
  JobBaseSchema.extend({ kind: z.literal("error"), error: z.enum(JOB_ERROR_CODES) }),
]);

export type Job = z.infer<typeof JobSchema>;

export type ContentJob = Extract<Job, { kind: "content" }>;
