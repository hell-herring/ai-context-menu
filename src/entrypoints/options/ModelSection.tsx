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

/** 取得したモデル一覧と、取得に使ったキーの版数（キーが変わった後に古い一覧を使わないため） */
interface FetchedModels {
  list: ModelInfo[];
  version: number;
}

/**
 * プロバイダ 1 つ分のモデルの設定（docs/spec.md §3.6）。
 * 一覧は Models API から取得したテキスト生成用のモデル。手入力もできるが、一覧にないモデルは保存時に警告する。
 */
export function ModelSection({
  provider,
  hasKey,
  keyVersion,
  getKeyVersion,
  settings,
  onSave,
}: {
  provider: ProviderId;
  hasKey: boolean;
  /** API キーの保存・削除を始めたとき・終えたときに変わる値（古いキーで取得した一覧を捨てるため） */
  keyVersion: number;
  /** 最新の `keyVersion`（非同期処理の完了時に、途中でキーが変わったかを判定する） */
  getKeyVersion: () => number;
  settings: CoreSettings;
  onSave: (update: (current: CoreSettings) => CoreSettingsPatch) => Promise<CoreSettings>;
}) {
  const inputId = useId();
  const listId = useId();
  const hintId = useId();
  const saved = settings.models[provider];
  const [input, setInput] = useState(saved);
  /** 取得した一覧と、取得に使ったキーの版数 */
  const [cache, setCache] = useState<FetchedModels | undefined>(undefined);
  const models = cache?.list;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | undefined>(undefined);

  // 他の操作で保存値が変わったら入力欄も合わせる
  useEffect(() => setInput(saved), [saved]);
  // キーを削除・差し替えたら、古いキーで取得した一覧は使わない
  // biome-ignore lint/correctness/useExhaustiveDependencies: キーの版数が変わったときだけ一覧を捨てる
  useEffect(() => setCache(undefined), [keyVersion]);

  /**
   * Models API から一覧を取得する（ユーザーの操作時のみ）。失敗したら理由を表示して undefined。
   * 取得中にキーが変わった場合は、古いキーの結果として捨てて `"stale"` を返す
   */
  const fetchModels = async (): Promise<FetchedModels | "stale" | undefined> => {
    const version = getKeyVersion();
    const isStale = () => getKeyVersion() !== version;
    try {
      const apiKey = await getApiKey(provider);
      if (isStale()) {
        return "stale";
      }
      if (apiKey === undefined) {
        setNotice({ message: t("optionsModelNeedsKey"), tone: "error" });
        return undefined;
      }
      const list = await PROVIDERS[provider].listModels(apiKey);
      if (isStale()) {
        return "stale";
      }
      const fetched = { list, version };
      setCache(fetched);
      return fetched;
    } catch (error) {
      if (isStale()) {
        return "stale";
      }
      const kind = error instanceof ProviderError ? error.kind : "unknown";
      setNotice({ message: t(PROVIDER_ERROR_MESSAGES[kind]), tone: "error" });
      return undefined;
    }
  };

  const load = async () => {
    setBusy(true);
    setNotice({ message: t("optionsModelFetching"), tone: "info" });
    try {
      const fetched = await fetchModels();
      if (fetched === "stale") {
        // 取得中にキーが変わった。古いキーの一覧は表示しない
        setNotice(undefined);
      } else if (fetched) {
        setNotice({
          message: t("optionsModelFetched", String(fetched.list.length)),
          tone: "success",
        });
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
      const fetched = cache ?? (hasKey ? await fetchModels() : undefined);
      // 確認に使った一覧（書き込みの直前に決める）
      const verified: { list: ModelInfo[] | undefined } = { list: undefined };
      const next = await onSave((current) => {
        // 取得中・保存までの間にキーの保存・削除が始まっていたら、古いキーの一覧で確認・上限の記録を
        // せず、確認していない扱いにする
        verified.list =
          fetched === "stale" || fetched === undefined || getKeyVersion() !== fetched.version
            ? undefined
            : fetched.list;
        const limits = verified.list && modelLimitsFrom(model, verified.list);
        return {
          models: { ...current.models, [provider]: model },
          modelLimits: {
            ...current.modelLimits,
            // 一覧を確認できなかった場合、モデルが変わっていなければ記録済みの上限を残す
            // （一時的な通信エラーで、確認済みの上限による頭打ちが外れないように）
            [provider]:
              verified.list === undefined && current.models[provider] === model
                ? current.modelLimits[provider]
                : limits,
          },
        };
      });
      const { list } = verified;
      const limits = list && modelLimitsFrom(model, list);
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
