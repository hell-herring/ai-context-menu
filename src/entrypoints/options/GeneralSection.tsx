import { type FormEvent, useEffect, useId, useState } from "react";
import { type MessageKey, t } from "../../lib/i18n";
import { exceededOutputLimit } from "../../lib/providers/limits";
import {
  CONFIRM_MODES,
  type ConfirmMode,
  type CoreSettings,
  OUTPUT_LANGUAGES,
  type OutputLanguage,
  SETTING_RANGES,
} from "../../lib/storage/schema";
import type { CoreSettingsPatch } from "../../lib/storage/settings";
import { SyncQuotaError } from "../../lib/storage/sync-quota";
import { type Notice, StatusMessage } from "./StatusMessage";
import { FIELD, HINT, PRIMARY_BUTTON } from "./styles";

const OUTPUT_LANGUAGE_LABELS = {
  browser: "optionsOutputLanguageBrowser",
  ja: "optionsOutputLanguageJa",
  en: "optionsOutputLanguageEn",
  source: "optionsOutputLanguageSource",
} as const satisfies Record<OutputLanguage, MessageKey>;

const CONFIRM_LABELS = {
  always: "optionsConfirmAlways",
  oversize: "optionsConfirmOversize",
  never: "optionsConfirmNever",
} as const satisfies Record<ConfirmMode, MessageKey>;

const numberFormat = new Intl.NumberFormat();

/** 保存時に拒否する理由（最新の設定と突き合わせた結果） */
class OutputLimitError extends Error {
  constructor(
    readonly model: string,
    readonly limit: number,
  ) {
    super("maxOutputTokens exceeds the model output limit");
  }
}

interface Form {
  outputLanguage: OutputLanguage;
  maxInputChars: string;
  maxOutputTokens: string;
  confirmBeforeSend: ConfirmMode;
}

type FormSettings = Pick<
  CoreSettings,
  "outputLanguage" | "maxInputChars" | "maxOutputTokens" | "confirmBeforeSend"
>;

function toForm(settings: FormSettings): Form {
  return {
    outputLanguage: settings.outputLanguage,
    maxInputChars: String(settings.maxInputChars),
    maxOutputTokens: String(settings.maxOutputTokens),
    confirmBeforeSend: settings.confirmBeforeSend,
  };
}

/** 範囲内の整数なら数値、そうでなければ undefined */
function parseInteger(value: string, range: { min: number; max: number }): number | undefined {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return parsed >= range.min && parsed <= range.max ? parsed : undefined;
}

/** 出力言語・最大入力文字数・最大出力トークン・送信前に確認（docs/spec.md §3.6） */
export function GeneralSection({
  settings,
  onSave,
}: {
  settings: CoreSettings;
  onSave: (update: (current: CoreSettings) => CoreSettingsPatch) => Promise<CoreSettings>;
}) {
  const headingId = useId();
  const ids = {
    outputLanguage: useId(),
    maxInputChars: useId(),
    maxInputCharsHint: useId(),
    maxOutputTokens: useId(),
    maxOutputTokensHint: useId(),
    confirmBeforeSend: useId(),
  };
  const [form, setForm] = useState<Form>(() => toForm(settings));
  const [notice, setNotice] = useState<Notice | undefined>(undefined);

  // 保存済みの値が変わったら（別の欄の保存後など）フォームを合わせる
  const { outputLanguage, maxInputChars, maxOutputTokens, confirmBeforeSend } = settings;
  useEffect(() => {
    setForm(toForm({ outputLanguage, maxInputChars, maxOutputTokens, confirmBeforeSend }));
  }, [outputLanguage, maxInputChars, maxOutputTokens, confirmBeforeSend]);

  const rangeError = (label: MessageKey, range: { min: number; max: number }) =>
    t("optionsRangeError", [
      t(label),
      numberFormat.format(range.min),
      numberFormat.format(range.max),
    ]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const inputChars = parseInteger(form.maxInputChars, SETTING_RANGES.maxInputChars);
    if (inputChars === undefined) {
      setNotice({
        message: rangeError("optionsMaxInputCharsLabel", SETTING_RANGES.maxInputChars),
        tone: "error",
      });
      return;
    }
    const outputTokens = parseInteger(form.maxOutputTokens, SETTING_RANGES.maxOutputTokens);
    if (outputTokens === undefined) {
      setNotice({
        message: rangeError("optionsMaxOutputTokensLabel", SETTING_RANGES.maxOutputTokens),
        tone: "error",
      });
      return;
    }
    try {
      await onSave((current) => {
        // 選択モデルの出力上限が分かる場合は、それを超える値を保存しない。
        // 保存済みの値のまま（後からモデルを変えて上限を超えた場合）は、他の項目の保存を妨げないよう
        // 拒否しない（リクエスト時にモデルの上限で頭打ちにする）
        const exceeded =
          outputTokens !== current.maxOutputTokens && exceededOutputLimit(current, outputTokens);
        if (exceeded) {
          throw new OutputLimitError(exceeded.model, exceeded.limit);
        }
        return {
          outputLanguage: form.outputLanguage,
          maxInputChars: inputChars,
          maxOutputTokens: outputTokens,
          confirmBeforeSend: form.confirmBeforeSend,
        };
      });
      setNotice({ message: t("optionsSaved"), tone: "success" });
    } catch (error) {
      if (error instanceof OutputLimitError) {
        setNotice({
          message: t("optionsOutputLimitExceeded", [error.model, numberFormat.format(error.limit)]),
          tone: "error",
        });
      } else if (error instanceof SyncQuotaError) {
        setNotice({
          message: t(error.reason === "item" ? "optionsSyncItemQuota" : "optionsSyncTotalQuota"),
          tone: "error",
        });
      } else {
        setNotice({ message: t("optionsSaveFailed"), tone: "error" });
      }
    }
  };

  const update = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <section className="flex flex-col gap-3" aria-labelledby={headingId}>
      <h2 id={headingId} className="font-semibold text-base">
        {t("optionsGeneralHeading")}
      </h2>
      {/* 範囲外の値はブラウザの検証ではなく、下の状態表示で理由を伝える */}
      <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void save(event)}>
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.outputLanguage} className="font-medium text-sm">
            {t("optionsOutputLanguageLabel")}
          </label>
          <select
            id={ids.outputLanguage}
            value={form.outputLanguage}
            onChange={(event) => {
              const value = OUTPUT_LANGUAGES.find((language) => language === event.target.value);
              if (value) {
                update("outputLanguage", value);
              }
            }}
            className={FIELD}
          >
            {OUTPUT_LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {t(OUTPUT_LANGUAGE_LABELS[language])}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={ids.maxInputChars} className="font-medium text-sm">
            {t("optionsMaxInputCharsLabel")}
          </label>
          <input
            id={ids.maxInputChars}
            type="number"
            inputMode="numeric"
            min={SETTING_RANGES.maxInputChars.min}
            max={SETTING_RANGES.maxInputChars.max}
            step={1}
            value={form.maxInputChars}
            onChange={(event) => update("maxInputChars", event.target.value)}
            aria-describedby={ids.maxInputCharsHint}
            className={FIELD}
          />
          <p id={ids.maxInputCharsHint} className={HINT}>
            {t("optionsMaxInputCharsHint", [
              numberFormat.format(SETTING_RANGES.maxInputChars.min),
              numberFormat.format(SETTING_RANGES.maxInputChars.max),
            ])}
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={ids.maxOutputTokens} className="font-medium text-sm">
            {t("optionsMaxOutputTokensLabel")}
          </label>
          <input
            id={ids.maxOutputTokens}
            type="number"
            inputMode="numeric"
            min={SETTING_RANGES.maxOutputTokens.min}
            max={SETTING_RANGES.maxOutputTokens.max}
            step={1}
            value={form.maxOutputTokens}
            onChange={(event) => update("maxOutputTokens", event.target.value)}
            aria-describedby={ids.maxOutputTokensHint}
            className={FIELD}
          />
          <p id={ids.maxOutputTokensHint} className={HINT}>
            {t("optionsMaxOutputTokensHint", [
              numberFormat.format(SETTING_RANGES.maxOutputTokens.min),
              numberFormat.format(SETTING_RANGES.maxOutputTokens.max),
            ])}
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={ids.confirmBeforeSend} className="font-medium text-sm">
            {t("optionsConfirmLabel")}
          </label>
          <select
            id={ids.confirmBeforeSend}
            value={form.confirmBeforeSend}
            onChange={(event) => {
              const value = CONFIRM_MODES.find((mode) => mode === event.target.value);
              if (value) {
                update("confirmBeforeSend", value);
              }
            }}
            className={FIELD}
          >
            {CONFIRM_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t(CONFIRM_LABELS[mode])}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-2">
          <button type="submit" className={PRIMARY_BUTTON}>
            {t("optionsSave")}
          </button>
        </div>
      </form>
      <StatusMessage notice={notice} />
    </section>
  );
}
