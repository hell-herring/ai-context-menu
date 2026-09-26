import { type FormEvent, useEffect, useId, useState } from "react";
import { type MessageKey, t } from "../../lib/i18n";
import {
  getApiKey,
  maskApiKey,
  normalizeApiKey,
  removeApiKey,
  setApiKey,
} from "../../lib/storage/secrets";

// M1 の最小設定画面: Anthropic の API キーの保存・削除のみ。接続テスト・モデル選択などは M2 で追加する

type Notice = { key: MessageKey; error: boolean };

export function App() {
  const inputId = useId();
  const [stored, setStored] = useState<string | undefined>(undefined);
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState<Notice | undefined>(undefined);

  useEffect(() => {
    getApiKey("anthropic")
      .then((key) => setStored(key === undefined ? undefined : maskApiKey(key)))
      .catch(() => setNotice({ key: "optionsSaveFailed", error: true }));
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const apiKey = normalizeApiKey(input);
    if (apiKey === undefined) {
      setNotice({ key: "optionsInvalidKey", error: true });
      return;
    }
    try {
      await setApiKey("anthropic", apiKey);
      setStored(maskApiKey(apiKey));
      setInput("");
      setNotice({ key: "optionsSaved", error: false });
    } catch {
      setNotice({ key: "optionsSaveFailed", error: true });
    }
  };

  const remove = async () => {
    try {
      await removeApiKey("anthropic");
      setStored(undefined);
      setNotice({ key: "optionsDeleted", error: false });
    } catch {
      setNotice({ key: "optionsSaveFailed", error: true });
    }
  };

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-6">
      <h1 className="font-semibold text-xl">{t("optionsTitle")}</h1>

      <p className="text-neutral-700 text-sm dark:text-neutral-300">{t("optionsDataNote")}</p>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-base">{t("optionsAnthropicHeading")}</h2>
        <p className="text-neutral-600 text-sm dark:text-neutral-400">
          {stored ? t("optionsKeyStored", stored) : t("optionsKeyNotStored")}
        </p>
        <form className="flex flex-col gap-2" onSubmit={(event) => void save(event)}>
          <label htmlFor={inputId} className="font-medium text-sm">
            {t("optionsApiKeyLabel")}
          </label>
          <input
            id={inputId}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="sk-ant-..."
            className="rounded-md border border-neutral-300 bg-transparent px-3 py-1.5 font-mono text-sm dark:border-neutral-600"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
            >
              {t("optionsSave")}
            </button>
            {stored && (
              <button
                type="button"
                onClick={() => void remove()}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800"
              >
                {t("optionsDelete")}
              </button>
            )}
          </div>
        </form>
        <p className="text-neutral-600 text-xs dark:text-neutral-400">{t("optionsStorageNote")}</p>
        <p
          role="status"
          aria-live="polite"
          className={`text-sm ${notice?.error ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}
        >
          {notice && t(notice.key)}
        </p>
      </section>
    </main>
  );
}
