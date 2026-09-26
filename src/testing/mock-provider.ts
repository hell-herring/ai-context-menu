import { PROVIDERS } from "../lib/providers/registry";
import {
  type ModelInfo,
  PROVIDER_IDS,
  type Provider,
  ProviderError,
  type ProviderErrorKind,
  type ProviderId,
  type StreamEvent,
  type SummarizeRequest,
} from "../lib/providers/types";

// E2E 用ビルド（`pnpm build:e2e`）専用のモックプロバイダ。外部には一切送信しない。
// 本番ビルドには含めない（tests/build/manifest.test.ts がマーカー `__AICM_TEST_ONLY__` の混入を検査する）

/** E2E テストから読む記録（サイドパネル・設定画面のページごと） */
interface MockRecord {
  requests: Array<{ provider: ProviderId; request: Omit<SummarizeRequest, "signal"> }>;
}

declare global {
  var __AICM_TEST_ONLY__: MockRecord | undefined;
}

/** 本文に含めるとモックの応答を変える指示（E2E テストのページに書く） */
export const MOCK_DIRECTIVES = {
  /** 停止されるまで少しずつ出力する */
  slow: "E2E_SLOW",
  /** 出力上限で途切れた扱いにする */
  maxTokens: "E2E_MAX_TOKENS",
  /** `E2E_ERROR:<種別>` でその種別のエラーにする */
  errorPrefix: "E2E_ERROR:",
} as const;

const MODELS: Record<ProviderId, ModelInfo[]> = {
  anthropic: [
    { id: "claude-opus-5", maxInputTokens: 200_000, maxOutputTokens: 32_000 },
    { id: "claude-e2e-small", maxInputTokens: 1_500, maxOutputTokens: 1_000 },
  ],
  openai: [{ id: "gpt-6-sol", maxInputTokens: undefined, maxOutputTokens: undefined }],
};

const ERROR_KINDS: readonly ProviderErrorKind[] = [
  "auth",
  "rate_limit",
  "overloaded",
  "network",
  "context_length",
  "bad_request",
  "unknown",
];

function record(): MockRecord {
  globalThis.__AICM_TEST_ONLY__ ??= { requests: [] };
  return globalThis.__AICM_TEST_ONLY__;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new ProviderError("aborted"));
      },
      { once: true },
    );
  });
}

/** 応答本文。安全な描画の確認用に、生 HTML と javascript: リンクを含める */
function reply(provider: ProviderId, req: SummarizeRequest): string[] {
  return [
    "## モック要約\n\n",
    `- プロバイダ: ${provider}\n`,
    `- モデル: ${req.model}\n`,
    `- 最大出力トークン: ${req.maxOutputTokens}\n\n`,
    '<img src="x" onerror="document.title=\'XSS\'"> ',
    "[危険なリンク](javascript:document.title='XSS') ",
    "[安全なリンク](https://example.com/)\n",
  ];
}

async function* stream(provider: ProviderId, req: SummarizeRequest): AsyncGenerator<StreamEvent> {
  const { signal, ...request } = req;
  record().requests.push({ provider, request });
  const errorAt = req.userContent.indexOf(MOCK_DIRECTIVES.errorPrefix);
  if (errorAt >= 0) {
    const kind = ERROR_KINDS.find((candidate) =>
      req.userContent.startsWith(candidate, errorAt + MOCK_DIRECTIVES.errorPrefix.length),
    );
    throw new ProviderError(kind ?? "unknown");
  }
  if (req.userContent.includes(MOCK_DIRECTIVES.slow)) {
    for (let i = 1; i <= 600; i++) {
      await sleep(100, signal);
      yield { type: "text", text: `チャンク${i} ` };
    }
  }
  for (const text of reply(provider, req)) {
    await sleep(10, signal);
    yield { type: "text", text };
  }
  const stopReason = req.userContent.includes(MOCK_DIRECTIVES.maxTokens) ? "max_tokens" : "end";
  yield {
    type: "done",
    stopReason,
    usage: { inputTokens: req.system.length + req.userContent.length, outputTokens: 42 },
  };
}

function createMockProvider(id: ProviderId): Provider {
  const verifyKey = async (apiKey: string) => {
    if (apiKey.includes("invalid")) {
      throw new ProviderError("auth", 401);
    }
  };
  return {
    id,
    displayName: PROVIDERS[id].displayName,
    async listModels(apiKey) {
      await verifyKey(apiKey);
      return MODELS[id];
    },
    verifyKey,
    stream: (_apiKey, req) => stream(id, req),
  };
}

/** プロバイダをモックに差し替える */
export function installMockProviders(): void {
  record();
  for (const id of PROVIDER_IDS) {
    PROVIDERS[id] = createMockProvider(id);
  }
}
