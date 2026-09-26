import { useState } from "react";
import { browser } from "wxt/browser";
import { MarkdownView } from "../../components/MarkdownView";
import { type MessageKey, t } from "../../lib/i18n";
import type { ModelOverflow } from "../../lib/job/request";
import { modelChoices, providerChoices, type Target } from "../../lib/job/target";
import {
  isPresetId,
  PRESET_IDS,
  PRESET_MENU_TITLE_KEYS,
  type PresetId,
} from "../../lib/prompt/presets";
import { estimateTokens } from "../../lib/prompt/tokens";
import { PROVIDER_ERROR_MESSAGES } from "../../lib/providers/error-messages";
import { PROVIDERS } from "../../lib/providers/registry";
import { PROVIDER_IDS, type ProviderId } from "../../lib/providers/types";
import type { ContentJob, JobErrorCode, RecentSummary } from "../../lib/storage/schema";
import { useRecent } from "./use-recent";
import {
  type ModelCheck,
  type PanelEnv,
  type PanelState,
  type Phase,
  useSummary,
} from "./use-summary";

const JOB_ERROR_MESSAGES = {
  editable: "errorEditable",
  unreadablePage: "errorUnreadablePage",
  excludedDomain: "errorExcludedDomain",
  emptyContent: "errorEmptyContent",
  tooLarge: "errorTooLarge",
  tooManyJobs: "errorTooManyJobs",
} as const satisfies Record<JobErrorCode, MessageKey>;

const PHASE_ERROR_MESSAGES = {
  ...PROVIDER_ERROR_MESSAGES,
  apiKeyMissing: "errorApiKeyMissing",
  excludedDomain: "errorExcludedDomain",
} as const satisfies Record<Extract<Phase, { kind: "error" }>["error"], MessageKey>;

const numberFormat = new Intl.NumberFormat(browser.i18n.getUILanguage());

function formatNumber(value: number): string {
  return numberFormat.format(value);
}

const timeFormat = new Intl.DateTimeFormat(browser.i18n.getUILanguage(), {
  hour: "2-digit",
  minute: "2-digit",
});
const dateTimeFormat = new Intl.DateTimeFormat(browser.i18n.getUILanguage(), {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** 保存時刻。今日なら時刻だけ */
function formatSavedAt(time: number): string {
  const date = new Date(time);
  return date.toDateString() === new Date().toDateString()
    ? timeFormat.format(date)
    : dateTimeFormat.format(date);
}

type SummaryState = Extract<PanelState, { kind: "summary" }>;

export function App() {
  const {
    state,
    env,
    selected,
    selectProvider,
    selectModel,
    selectPreset,
    confirm,
    cancel,
    stop,
    regenerate,
  } = useSummary();
  const recent = useRecent();

  // 表示中の最近の要約。新しいジョブを受け取ったら、そのジョブの表示に戻す
  const jobKey: unknown = state.kind === "summary" ? state.job.id : state;
  const [viewing, setViewing] = useState<{ id: string; jobKey: unknown } | undefined>(undefined);
  const viewed =
    viewing && viewing.jobKey === jobKey
      ? recent.summaries.find((summary) => summary.id === viewing.id)
      : undefined;
  // 表示中のジョブの結果は一覧に出さない
  const listed = recent.summaries.filter(
    (summary) => state.kind !== "summary" || summary.id !== state.job.id,
  );

  return (
    <main className="flex min-h-screen flex-col gap-3 p-4">
      <Header />
      {viewed ? (
        <RecentView summary={viewed} onBack={() => setViewing(undefined)} />
      ) : (
        <>
          {state.kind === "summary" && env && (
            <TargetPicker
              state={state}
              env={env}
              selected={selected}
              onProvider={selectProvider}
              onModel={selectModel}
              onPreset={selectPreset}
            />
          )}
          <Body state={state} onConfirm={confirm} onCancel={cancel} />
          {state.kind === "summary" && (
            <Actions state={state} onStop={stop} onRegenerate={regenerate} />
          )}
        </>
      )}
      {listed.length > 0 && (
        <RecentList
          summaries={listed}
          viewedId={viewed?.id}
          onView={(id) => {
            setViewing({ id, jobKey });
            window.scrollTo({ top: 0 });
          }}
          onClear={recent.clear}
        />
      )}
    </main>
  );
}

/**
 * 最近の要約の一覧（docs/spec.md §3.4。このブラウザを閉じるまで最大 10 件）。
 * 項目を押すと保存した結果を表示する（再生成はできない）
 */
function RecentList({
  summaries,
  viewedId,
  onView,
  onClear,
}: {
  summaries: readonly RecentSummary[];
  viewedId: string | undefined;
  onView: (id: string) => void;
  onClear: () => void;
}) {
  return (
    <details className="mt-auto border-neutral-200 border-t pt-3 text-sm dark:border-neutral-700">
      <summary className="cursor-pointer font-medium">
        {t("recentHeading", formatNumber(summaries.length))}
      </summary>
      <ul className="mt-2 flex flex-col gap-1">
        {summaries.map((summary) => (
          <li key={summary.id}>
            <button
              type="button"
              onClick={() => onView(summary.id)}
              aria-current={summary.id === viewedId ? "true" : undefined}
              className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-blue-500 aria-[current]:bg-neutral-100 dark:aria-[current]:bg-neutral-800 dark:hover:bg-neutral-800"
            >
              <span className="line-clamp-1 w-full">{summary.title || t("sourceUntitled")}</span>
              <span className="text-neutral-600 text-xs dark:text-neutral-400">
                {formatSavedAt(summary.createdAt)} · {t(PRESET_MENU_TITLE_KEYS[summary.presetId])}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-neutral-600 text-xs dark:text-neutral-400">{t("recentNote")}</p>
        <Button onClick={onClear}>{t("recentClear")}</Button>
      </div>
    </details>
  );
}

/** 保存した最近の要約の表示（読み取り専用） */
function RecentView({ summary, onBack }: { summary: RecentSummary; onBack: () => void }) {
  return (
    <>
      <div>
        <Button onClick={onBack}>{t("recentBack")}</Button>
      </div>
      <section className="flex flex-col gap-0.5 rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-700">
        <p className="line-clamp-2 font-medium">{summary.title || t("sourceUntitled")}</p>
        <p className="truncate text-neutral-600 text-xs dark:text-neutral-400">
          {summary.displayUrl}
        </p>
        <p className="text-neutral-600 text-xs dark:text-neutral-400">
          {t(summary.sourceType === "page" ? "sourcePage" : "sourceSelection")} ·{" "}
          {PROVIDERS[summary.provider].displayName} · {summary.model} ·{" "}
          {t(PRESET_MENU_TITLE_KEYS[summary.presetId])}
        </p>
        <p className="text-neutral-600 text-xs dark:text-neutral-400">
          {t("recentSavedAt", formatSavedAt(summary.createdAt))}
        </p>
      </section>
      {summary.text !== "" && <MarkdownView text={summary.text} />}
      {summary.stopReason !== "end" && (
        <p className="text-neutral-600 text-xs dark:text-neutral-400">
          {t(summary.stopReason === "max_tokens" ? "statusMaxTokens" : "statusRefusal")}
        </p>
      )}
      {summary.truncated && (
        <p className="text-amber-700 text-xs dark:text-amber-400">{t("recentTruncated")}</p>
      )}
      {summary.text !== "" && (
        <div className="flex flex-wrap gap-2 border-neutral-200 border-t pt-3 dark:border-neutral-700">
          <CopyButton key={summary.id} text={summary.text} />
        </div>
      )}
    </>
  );
}

function Header() {
  return (
    <header className="flex items-center justify-between gap-2">
      <h1 className="font-semibold text-base">{t("extName")}</h1>
      <button
        type="button"
        onClick={() => void browser.runtime.openOptionsPage()}
        aria-label={t("buttonOpenOptions")}
        title={t("buttonOpenOptions")}
        className="rounded-md px-2 py-1 text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-neutral-400 dark:hover:bg-neutral-800"
      >
        <span aria-hidden="true">⚙</span>
      </button>
    </header>
  );
}

const SELECT =
  "min-w-0 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-900";

/**
 * 送信先（プロバイダ・モデル）とプリセットの切り替え（docs/spec.md §3.4）。
 * 切り替えただけでは送信せず、再生成（確認中なら送信）で反映する。このジョブだけに効かせ、設定は変えない
 */
function TargetPicker({
  state,
  env,
  selected,
  onProvider,
  onModel,
  onPreset,
}: {
  state: SummaryState;
  env: PanelEnv;
  selected: Target | undefined;
  onProvider: (provider: ProviderId) => void;
  onModel: (model: string) => void;
  onPreset: (presetId: PresetId) => void;
}) {
  const { phase, sent, presetId } = state;
  // 送信中は、表示と送信中の内容が食い違わないよう切り替えさせない。
  // キャンセルした後は送信（再生成）できないため切り替えても意味がない
  const disabled =
    phase.kind === "preparing" || phase.kind === "streaming" || phase.kind === "cancelled";
  const providers = providerChoices(env.keys, selected?.provider);
  const models = selected ? modelChoices(env.settings, selected.provider) : [];
  // 送った内容と選択が違えば、再生成で反映されることを伝える
  const changed =
    sent !== undefined &&
    (sent.provider !== selected?.provider ||
      sent.model !== selected?.model ||
      sent.presetId !== presetId);
  const showPending = changed && phase.kind !== "confirm" && !disabled;
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-2">
        {selected && (
          <>
            <select
              aria-label={t("pickerProvider")}
              value={selected.provider}
              disabled={disabled}
              onChange={(event) => {
                const provider = PROVIDER_IDS.find((id) => id === event.target.value);
                if (provider) {
                  onProvider(provider);
                }
              }}
              className={SELECT}
            >
              {providers.map((provider) => (
                <option key={provider} value={provider}>
                  {PROVIDERS[provider].displayName}
                </option>
              ))}
            </select>
            <select
              aria-label={t("pickerModel")}
              value={selected.model}
              disabled={disabled}
              onChange={(event) => onModel(event.target.value)}
              className={`${SELECT} max-w-full font-mono`}
            >
              {/* 選んだ後に設定のモデルが変わっても、選択中のモデルは選択肢に残す */}
              {[...new Set([selected.model, ...models])].map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </>
        )}
        <select
          aria-label={t("pickerPreset")}
          value={presetId}
          disabled={disabled}
          onChange={(event) => {
            if (isPresetId(event.target.value)) {
              onPreset(event.target.value);
            }
          }}
          className={SELECT}
        >
          {PRESET_IDS.map((id) => (
            <option key={id} value={id}>
              {t(PRESET_MENU_TITLE_KEYS[id])}
            </option>
          ))}
        </select>
      </div>
      {phase.kind !== "confirm" && state.switchCheck && <SwitchWarning check={state.switchCheck} />}
      {showPending && (
        <p className="text-neutral-600 text-xs dark:text-neutral-400">{t("pickerPending")}</p>
      )}
    </section>
  );
}

/** 切り替えた送信先のモデルの入力上限に収まらない場合の表示 */
function SwitchWarning({ check }: { check: ModelCheck }) {
  const { overflow } = check;
  return (
    <p className="text-amber-700 text-xs dark:text-amber-400">
      {check.kind === "tooLong"
        ? t("pickerTooLong", overflow.model)
        : t("pickerOverflow", [
            overflow.model,
            formatNumber(overflow.estimatedTokens),
            formatNumber(overflow.budget),
          ])}
    </p>
  );
}

function Body({
  state,
  onConfirm,
  onCancel,
}: {
  state: PanelState;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  switch (state.kind) {
    case "idle":
      return (
        <p className="text-neutral-600 text-sm dark:text-neutral-400">{t("sidePanelEmpty")}</p>
      );
    case "jobError":
      return <ErrorMessage message={t(JOB_ERROR_MESSAGES[state.error])} />;
    case "summary":
      return (
        <>
          <SourceInfo job={state.job} fittedChars={state.fittedChars} />
          {state.phase.kind === "confirm" ? (
            <SendConfirm
              job={state.job}
              overflow={state.phase.overflow}
              onConfirm={onConfirm}
              onCancel={onCancel}
            />
          ) : (
            <>
              {state.text !== "" && <MarkdownView text={state.text} />}
              <Status phase={state.phase} />
            </>
          )}
        </>
      );
  }
}

/** 何を送ったか（対象種別・タイトル・URL・文字数・切り詰め有無）を常に表示する（docs/guardrails.md §2） */
function SourceInfo({ job, fittedChars }: { job: ContentJob; fittedChars: number | undefined }) {
  const { source } = job;
  const truncatedContent = source.oversizeReasons.includes("content");
  const truncatedMetadata = source.oversizeReasons.includes("metadata");
  return (
    <section className="flex flex-col gap-0.5 rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-700">
      <p className="line-clamp-2 font-medium">{source.title || t("sourceUntitled")}</p>
      <p className="truncate text-neutral-600 text-xs dark:text-neutral-400">{source.displayUrl}</p>
      <p className="text-neutral-600 text-xs dark:text-neutral-400">
        {t(source.type === "page" ? "sourcePage" : "sourceSelection")} ·{" "}
        {t("sourceChars", formatNumber(source.text.length))}
      </p>
      {source.providerUrl === "" && (
        <p className="text-neutral-600 text-xs dark:text-neutral-400">{t("sourceUrlNotSent")}</p>
      )}
      {truncatedContent && (
        <p className="text-amber-700 text-xs dark:text-amber-400">
          {t("sourceTruncatedContent", formatNumber(source.inputLimit))}
        </p>
      )}
      {fittedChars !== undefined && (
        <p className="text-amber-700 text-xs dark:text-amber-400">
          {t("sourceFittedToModel", formatNumber(fittedChars))}
        </p>
      )}
      {truncatedMetadata && (
        <p className="text-amber-700 text-xs dark:text-amber-400">{t("sourceTruncatedMetadata")}</p>
      )}
    </section>
  );
}

/**
 * 送信前の確認。上限超過・モデルの入力上限の超過なら理由と切り詰めて送るボタン、
 * そうでなければ（設定「常に」）送信するかを尋ねる
 */
function SendConfirm({
  job,
  overflow,
  onConfirm,
  onCancel,
}: {
  job: ContentJob;
  overflow: ModelOverflow | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { source } = job;
  if (!source.oversize && !overflow) {
    return (
      <section
        className="flex flex-col gap-2 rounded-md border border-neutral-300 p-3 text-sm dark:border-neutral-600"
        aria-labelledby="confirm-title"
      >
        <h2 id="confirm-title" className="font-semibold">
          {t("confirmTitle")}
        </h2>
        <div className="flex gap-2">
          <Button onClick={onConfirm} primary>
            {t("buttonSend")}
          </Button>
          <Button onClick={onCancel}>{t("buttonCancel")}</Button>
        </div>
      </section>
    );
  }
  return (
    <section
      className="flex flex-col gap-2 rounded-md border border-amber-400 p-3 text-sm dark:border-amber-600"
      aria-labelledby="oversize-title"
    >
      <h2 id="oversize-title" className="font-semibold">
        {t("oversizeTitle")}
      </h2>
      {source.oversizeReasons.includes("content") && (
        <p>
          {t("oversizeContent", [
            formatNumber(source.originalLength),
            formatNumber(source.inputLimit),
            formatNumber(estimateTokens(source.text)),
          ])}
        </p>
      )}
      {source.oversizeReasons.includes("metadata") && <p>{t("oversizeMetadata")}</p>}
      {overflow && (
        <p>
          {t("modelOverflow", [
            overflow.model,
            formatNumber(overflow.estimatedTokens),
            formatNumber(overflow.budget),
          ])}
        </p>
      )}
      <div className="flex gap-2">
        <Button onClick={onConfirm} primary>
          {t(overflow ? "buttonSendFitted" : "buttonSendTruncated")}
        </Button>
        <Button onClick={onCancel}>{t("buttonCancel")}</Button>
      </div>
    </section>
  );
}

function Status({ phase }: { phase: Phase }) {
  return (
    // 生成完了などをスクリーンリーダーへ通知する
    <p role="status" aria-live="polite" className="text-neutral-600 text-xs dark:text-neutral-400">
      <StatusText phase={phase} />
    </p>
  );
}

function StatusText({ phase }: { phase: Phase }) {
  switch (phase.kind) {
    case "preparing":
    case "confirm":
      return null;
    case "cancelled":
      return t("statusCancelled");
    case "streaming":
      return t("statusStreaming");
    case "stopped":
      return t("statusStopped");
    case "done": {
      const message =
        phase.stopReason === "max_tokens"
          ? t("statusMaxTokens")
          : phase.stopReason === "refusal"
            ? t("statusRefusal")
            : t("statusDone");
      const usage = phase.usage
        ? ` · ${t("usageTokens", [formatNumber(phase.usage.inputTokens), formatNumber(phase.usage.outputTokens)])}`
        : "";
      return `${message}${usage}`;
    }
    case "error":
      return (
        <span className="flex flex-col items-start gap-2">
          <span className="text-red-700 dark:text-red-400">
            {t(PHASE_ERROR_MESSAGES[phase.error])}
          </span>
          {phase.error === "apiKeyMissing" && (
            <Button onClick={() => void browser.runtime.openOptionsPage()}>
              {t("buttonOpenOptions")}
            </Button>
          )}
        </span>
      );
  }
}

function Actions({
  state,
  onStop,
  onRegenerate,
}: {
  state: SummaryState;
  onStop: () => void;
  onRegenerate: () => void;
}) {
  const { phase } = state;
  if (phase.kind === "preparing" || phase.kind === "confirm") {
    return null;
  }
  const streaming = phase.kind === "streaming";
  const canRegenerate = !streaming && phase.kind !== "cancelled";
  return (
    <div className="flex flex-wrap gap-2 border-neutral-200 border-t pt-3 dark:border-neutral-700">
      {streaming && <Button onClick={onStop}>{t("buttonStop")}</Button>}
      {canRegenerate && <Button onClick={onRegenerate}>{t("buttonRegenerate")}</Button>}
      {state.text !== "" && <CopyButton text={state.text} />}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [result, setResult] = useState<"copied" | "copyFailed" | undefined>(undefined);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setResult("copied");
    } catch {
      setResult("copyFailed");
    }
  };
  return (
    <>
      <Button onClick={() => void copy()}>{t("buttonCopy")}</Button>
      <span
        role="status"
        aria-live="polite"
        className="self-center text-neutral-600 text-xs dark:text-neutral-400"
      >
        {result && t(result)}
      </span>
    </>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <p role="alert" className="text-red-700 text-sm dark:text-red-400">
      {message}
    </p>
  );
}

function Button({
  onClick,
  primary = false,
  children,
}: {
  onClick: () => void;
  primary?: boolean;
  children: React.ReactNode;
}) {
  const style = primary
    ? "bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
    : "border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-blue-500 ${style}`}
    >
      {children}
    </button>
  );
}
