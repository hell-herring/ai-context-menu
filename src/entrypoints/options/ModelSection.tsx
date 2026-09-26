import { type FormEvent, useEffect, useId, useState } from "react";
import { t } from "../../lib/i18n";
import { DEFAULT_MODELS } from "../../lib/providers/defaults";
import { PROVIDER_ERROR_MESSAGES } from "../../lib/providers/error-messages";
import { modelLimitsFrom } from "../../lib/providers/limits";
import { PROVIDERS } from "../../lib/providers/registry";
import { type ModelInfo, ProviderError, type ProviderId } from "../../lib/providers/types";
import { type CoreSettings, ModelIdSchema } from "../../lib/storage/schema";
import { getApiKey } from "../../lib/storage/secrets";
import type { CoreSettingsPatch } from "../../lib/storage/settings";
import { type Notice, StatusMessage } from "./StatusMessage";
import { FIELD, HINT, PRIMARY_BUTTON, SECONDARY_BUTTON } from "./styles";

const numberFormat = new Intl.NumberFormat();

/**
 * プロバイダ 1 つ分のモデルの設定（docs/spec.md §3.6）。
 * 一覧は Models API から取得したテキスト生成用のモデル。手入力もできるが、一覧にないモデルは保存時に警告する。
 */
export function ModelSection({
  provider,
  storedKey,
  settings,
  onSave,
}: {
  provider: ProviderId;
  /** 保存済みの API キー（マスク済み）。未設定なら undefined */
  storedKey: string | undefined;
  settings: CoreSettings;
  onSave: (update: (current: CoreSettings) => CoreSettingsPatch) => Promise<CoreSettings>;
}) {
  const inputId = useId();
  const listId = useId();
  const hintId = useId();
  const hasKey = storedKey !== undefined;
  const saved = settings.models[provider];
  const [input, setInput] = useState(saved);
  const [models, setModels] = useState<ModelInfo[] | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | undefined>(undefined);

  // 他の操作で保存値が変わったら入力欄も合わせる
  useEffect(() => setInput(saved), [saved]);
  // キーを削除・差し替えたら、古いキーで取得した一覧は使わない
  // biome-ignore lint/correctness/useExhaustiveDependencies: キーが変わったときだけ一覧を捨てる
  useEffect(() => setModels(undefined), [storedKey]);

  /** Models API から一覧を取得する（ユーザーの操作時のみ）。失敗したら理由を表示して undefined */
  const fetchModels = async (): Promise<ModelInfo[] | undefined> => {
    try {
      const apiKey = await getApiKey(provider);
      if (apiKey === undefined) {
        setNotice({ message: t("optionsModelNeedsKey"), tone: "error" });
        return undefined;
      }
      const list = await PROVIDERS[provider].listModels(apiKey);
      setModels(list);
      return list;
    } catch (error) {
      const kind = error instanceof ProviderError ? error.kind : "unknown";
      setNotice({ message: t(PROVIDER_ERROR_MESSAGES[kind]), tone: "error" });
      return undefined;
    }
  };

  const load = async () => {
    setBusy(true);
    setNotice({ message: t("optionsModelFetching"), tone: "info" });
    try {
      const list = await fetchModels();
      if (list) {
        setNotice({ message: t("optionsModelFetched", String(list.length)), tone: "success" });
      }
    } finally {
      setBusy(false);
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = ModelIdSchema.safeParse(input);
    if (!parsed.success) {
      setNotice({ message: t("optionsModelInvalid"), tone: "error" });
      return;
    }
    const model = parsed.data;
    setBusy(true);
    try {
      // 一覧にあるか確認するため、未取得なら取得する（キーがなければ確認せずに保存する）
      const list = models ?? (hasKey ? await fetchModels() : undefined);
      const limits = list && modelLimitsFrom(model, list);
      const next = await onSave((current) => ({
        models: { ...current.models, [provider]: model },
        modelLimits: { ...current.modelLimits, [provider]: limits },
      }));
      setInput(model);
      if (list === undefined) {
        setNotice({
          message: hasKey ? t("optionsModelUnverified") : t("optionsSaved"),
          tone: hasKey ? "error" : "success",
        });
      } else if (!list.some((candidate) => candidate.id === model)) {
        setNotice({ message: t("optionsModelNotInList", model), tone: "error" });
      } else if (
        limits?.maxOutputTokens !== undefined &&
        limits.maxOutputTokens < next.maxOutputTokens
      ) {
        setNotice({
          message: t("optionsModelOutputCapped", numberFormat.format(limits.maxOutputTokens)),
          tone: "success",
        });
      } else {
        setNotice({ message: t("optionsSaved"), tone: "success" });
      }
    } catch {
      setNotice({ message: t("optionsSaveFailed"), tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="flex flex-col gap-2" onSubmit={(event) => void save(event)}>
      <label htmlFor={inputId} className="font-medium text-sm">
        {t("optionsModelLabel")}
      </label>
      <input
        id={inputId}
        type="text"
        list={listId}
        autoComplete="off"
        spellCheck={false}
        maxLength={200}
        value={input}
        onChange={(event) => setInput(event.target.value)}
        aria-describedby={hintId}
        className={`${FIELD} font-mono`}
      />
      <datalist id={listId}>
        {models?.map((model) => (
          <option key={model.id} value={model.id} />
        ))}
      </datalist>
      <p id={hintId} className={HINT}>
        {t("optionsModelDefault", DEFAULT_MODELS[provider])}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={PRIMARY_BUTTON}>
          {t("optionsSave")}
        </button>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy || !hasKey}
          className={SECONDARY_BUTTON}
        >
          {t("optionsModelFetch")}
        </button>
      </div>
      <StatusMessage notice={notice} />
    </form>
  );
}
