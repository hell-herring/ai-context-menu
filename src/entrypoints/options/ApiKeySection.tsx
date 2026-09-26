import { type FormEvent, useId, useState } from "react";
import { type MessageKey, t } from "../../lib/i18n";
import { PROVIDERS } from "../../lib/providers/registry";
import type { ProviderId } from "../../lib/providers/types";
import { maskApiKey, normalizeApiKey, removeApiKey, setApiKey } from "../../lib/storage/secrets";

type Notice = { key: MessageKey; error: boolean };

const HEADINGS = {
  anthropic: "optionsAnthropicHeading",
  openai: "optionsOpenaiHeading",
} as const satisfies Record<ProviderId, MessageKey>;

/** 入力欄のプレースホルダ（キーの形式の目安。実キーではない） */
const PLACEHOLDERS: Record<ProviderId, string> = {
  anthropic: "sk-ant-...",
  openai: "sk-...",
};

/** プロバイダ 1 つ分の API キーの保存・削除。キーは storage.local のみに置く（docs/guardrails.md §1） */
export function ApiKeySection({
  provider,
  stored,
  onChange,
}: {
  provider: ProviderId;
  /** 保存済みのキー（マスク済み）。未設定なら undefined */
  stored: string | undefined;
  /** 保存・削除の後に呼ぶ。引数は新しいマスク済みのキー */
  onChange: (masked: string | undefined) => Promise<void>;
}) {
  const headingId = useId();
  const inputId = useId();
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState<Notice | undefined>(undefined);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const apiKey = normalizeApiKey(input);
    if (apiKey === undefined) {
      setNotice({ key: "optionsInvalidKey", error: true });
      return;
    }
    try {
      await setApiKey(provider, apiKey);
      setInput("");
      await onChange(maskApiKey(apiKey));
      setNotice({ key: "optionsSaved", error: false });
    } catch {
      setNotice({ key: "optionsSaveFailed", error: true });
    }
  };

  const remove = async () => {
    try {
      await removeApiKey(provider);
      await onChange(undefined);
      setNotice({ key: "optionsDeleted", error: false });
    } catch {
      setNotice({ key: "optionsSaveFailed", error: true });
    }
  };

  return (
    <section className="flex flex-col gap-3" aria-labelledby={headingId}>
      <h2 id={headingId} className="font-semibold text-base">
        {t(HEADINGS[provider])}
      </h2>
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
          placeholder={PLACEHOLDERS[provider]}
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
      <p className="text-neutral-600 text-xs dark:text-neutral-400">
        {t("optionsStorageNote", PROVIDERS[provider].displayName)}
      </p>
      <p
        role="status"
        aria-live="polite"
        className={`text-sm ${notice?.error ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}
      >
        {notice && t(notice.key)}
      </p>
    </section>
  );
}
