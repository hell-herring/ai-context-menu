import { z } from "zod";
import { MAX_EXCLUDED_DOMAINS } from "../domain/exclude";
import { PRESET_IDS } from "../prompt/presets";
import { DEFAULT_MODELS } from "../providers/defaults";
import { PROVIDER_IDS } from "../providers/types";

// ストレージに置く値のスキーマ。読み出した値は必ずここで検証してから使う（docs/guardrails.md §5）

// ---------------------------------------------------------------------------
// 設定（storage.sync `settings.core`）
// ---------------------------------------------------------------------------

export const OUTPUT_LANGUAGES = ["browser", "ja", "en", "source"] as const;

export type OutputLanguage = (typeof OUTPUT_LANGUAGES)[number];

/** 送信前に確認するか。`never` でも上限超過時は必ず確認する（入力を黙って切り詰めない。docs/spec.md §3.3） */
export const CONFIRM_MODES = ["always", "oversize", "never"] as const;

export type ConfirmMode = (typeof CONFIRM_MODES)[number];

/** 最大入力文字数・最大出力トークンの範囲（docs/spec.md §3.6） */
export const SETTING_RANGES = {
  maxInputChars: { min: 1_000, max: 500_000 },
  maxOutputTokens: { min: 256, max: 32_000 },
} as const;

export const ModelIdSchema = z.string().trim().min(1).max(200);

const TokenCountSchema = z.int().positive();

/**
 * 選択したモデルの上限（モデル一覧から保存時に記録する。分からない項目は持たない）。
 * `model` が現在のモデル設定と一致するときだけ使う（lib/providers/limits.ts）
 */
export const ModelLimitsSchema = z.object({
  model: ModelIdSchema,
  maxInputTokens: TokenCountSchema.optional(),
  maxOutputTokens: TokenCountSchema.optional(),
});

export type ModelLimits = z.infer<typeof ModelLimitsSchema>;

export const CoreSettingsSchema = z.object({
  version: z.literal(1),
  models: z.object({
    anthropic: ModelIdSchema,
    // M2 で追加した項目。M1 で保存された値にはないため既定値で補う
    openai: ModelIdSchema.default(DEFAULT_MODELS.openai),
  }),
  /** 使用するプロバイダ。未設定・キーが未登録なら、キーのあるプロバイダを使う（lib/providers/select.ts） */
  defaultProvider: z.enum(PROVIDER_IDS).optional(),
  // 以下 2 項目は設定画面の PR で追加した。それより前に保存された値にはないため既定値で補う
  /** プロバイダごとの、選択したモデルの上限 */
  modelLimits: z
    .object({
      anthropic: ModelLimitsSchema.optional(),
      openai: ModelLimitsSchema.optional(),
    })
    .default({}),
  confirmBeforeSend: z.enum(CONFIRM_MODES).default("oversize"),
  outputLanguage: z.enum(OUTPUT_LANGUAGES),
  /** 送信する本文の上限（XML エスケープ後の文字数） */
  maxInputChars: z
    .int()
    .min(SETTING_RANGES.maxInputChars.min)
    .max(SETTING_RANGES.maxInputChars.max),
  maxOutputTokens: z
    .int()
    .min(SETTING_RANGES.maxOutputTokens.min)
    .max(SETTING_RANGES.maxOutputTokens.max),
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
  /** DNS のホスト名の上限は 253 文字（末尾のドット・IDN を考慮して余裕を持たせる） */
  hostname: 255,
  /** ページ・フレームの URL と、フレームの実際のオリジン・祖先オリジン（extract/origins.ts）の分 */
  hostnames: 40,
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
  /**
   * 送信直前の除外判定用。切り詰める前のページ URL・フレーム URL（と、URL にホスト名がないフレームでは
   * 実際のオリジン・祖先オリジン）から求めた正規化済みホスト名
   * （保存用に短縮した URL からはホスト名を正しく読み直せない場合があるため）
   */
  hostnames: z.array(z.string().min(1).max(JOB_LIMITS.hostname)).max(JOB_LIMITS.hostnames),
});

export type JobBase = z.infer<typeof JobBaseSchema>;

export const JobSourceSchema = z.object({
  type: z.enum(SOURCE_TYPES),
  method: z.enum(EXTRACT_METHODS),
  title: z.string().max(JOB_LIMITS.title),
  /** サイドパネルの表示用（ローカルのみ） */
  displayUrl: z.string().max(JOB_LIMITS.displayUrl),
  /** プロバイダへ送る URL（origin + pathname のみ）。取得できなければ空 */
  providerUrl: z.string().max(JOB_LIMITS.providerUrl),
  /** 送信直前の除外判定用。切り詰める前の取得元 URL の正規化済みホスト名。なければ空 */
  hostname: z.string().max(JOB_LIMITS.hostname),
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
