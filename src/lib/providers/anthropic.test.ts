import { describe, expect, it, vi } from "vitest";
import { createAnthropicProvider } from "./anthropic";
import { ProviderError, type StreamEvent, type SummarizeRequest } from "./types";

// 実 API は呼ばない。SDK に fetch を差し替えてレスポンスをモックする（docs/guardrails.md §5）
const DUMMY_KEY = "sk-test-dummy";

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

function sse(events: Record<string, unknown>[]): Response {
  const body = events
    .map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function messageStream(texts: string[], stopReason = "end_turn", model = "claude-opus-5") {
  return sse([
    {
      type: "message_start",
      message: {
        id: "msg_test",
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 12, output_tokens: 0 },
      },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    ...texts.map((text) => ({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    })),
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: 34 },
    },
    { type: "message_stop" },
  ]);
}

function jsonError(status: number, type: string): Response {
  return new Response(JSON.stringify({ type: "error", error: { type, message: "test error" } }), {
    status,
    // SDK の自動リトライを待たずに済むよう、再試行までの待ち時間を最小にする
    headers: { "content-type": "application/json", "retry-after-ms": "1" },
  });
}

function request(overrides: Partial<SummarizeRequest> = {}): SummarizeRequest {
  return {
    system: "system prompt",
    userContent: "user content",
    model: "claude-opus-5",
    maxOutputTokens: 8_000,
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function collect(events: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const result: StreamEvent[] = [];
  for await (const event of events) {
    result.push(event);
  }
  return result;
}

async function streamError(fetchMock: FetchMock, req = request()): Promise<ProviderError> {
  const provider = createAnthropicProvider({ fetch: fetchMock });
  try {
    await collect(provider.stream(DUMMY_KEY, req));
  } catch (error) {
    if (error instanceof ProviderError) {
      return error;
    }
    throw error;
  }
  throw new Error("stream should fail");
}

function sentRequest(fetchMock: FetchMock) {
  const [input, init] = fetchMock.mock.calls[0] ?? [];
  const headers = new Headers(init?.headers);
  return {
    url: String(input),
    headers,
    body: JSON.parse(String(init?.body)) as Record<string, unknown>,
  };
}

describe("AnthropicProvider.stream", () => {
  it("テキストを逐次返し、最後に終了理由と使用量を返す", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => messageStream(["要約", "です"]));
    const provider = createAnthropicProvider({ fetch: fetchMock });

    expect(await collect(provider.stream(DUMMY_KEY, request()))).toEqual([
      { type: "text", text: "要約" },
      { type: "text", text: "です" },
      { type: "done", stopReason: "end", usage: { inputTokens: 12, outputTokens: 34 } },
    ]);
  });

  it("公式ホストに、既知モデル向けのパラメータ（effort・サーバー側フォールバック）を付けて送る", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => messageStream(["ok"]));
    await collect(createAnthropicProvider({ fetch: fetchMock }).stream(DUMMY_KEY, request()));

    const { url, headers, body } = sentRequest(fetchMock);
    expect(new URL(url).origin).toBe("https://api.anthropic.com");
    expect(new URL(url).pathname).toBe("/v1/messages");
    expect(headers.get("x-api-key")).toBe(DUMMY_KEY);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("anthropic-beta")).toBe("server-side-fallback-2026-07-01");
    expect(body).toEqual({
      model: "claude-opus-5",
      max_tokens: 8_000,
      system: "system prompt",
      messages: [{ role: "user", content: "user content" }],
      output_config: { effort: "medium" },
      fallbacks: "default",
      stream: true,
    });
  });

  it("許可リストにないモデルにはモデル依存パラメータを付けない", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => messageStream(["ok"], "end_turn", "x"));
    await collect(
      createAnthropicProvider({ fetch: fetchMock }).stream(
        DUMMY_KEY,
        request({ model: "claude-unknown-1" }),
      ),
    );

    const { headers, body } = sentRequest(fetchMock);
    expect(headers.get("anthropic-beta")).toBeNull();
    expect(body).not.toHaveProperty("output_config");
    expect(body).not.toHaveProperty("fallbacks");
    expect(body).not.toHaveProperty("thinking");
  });

  it.each([
    ["max_tokens", "max_tokens"],
    ["refusal", "refusal"],
    ["model_context_window_exceeded", "max_tokens"],
    ["stop_sequence", "end"],
  ])("stop_reason %s → %s", async (stopReason, expected) => {
    const fetchMock = vi.fn<typeof fetch>(async () => messageStream(["途中"], stopReason));
    const events = await collect(
      createAnthropicProvider({ fetch: fetchMock }).stream(DUMMY_KEY, request()),
    );
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: expected });
  });

  it.each([
    [401, "authentication_error", "auth"],
    [403, "permission_error", "auth"],
    [429, "rate_limit_error", "rate_limit"],
    [529, "overloaded_error", "overloaded"],
    [500, "api_error", "overloaded"],
    [400, "invalid_request_error", "bad_request"],
  ])("HTTP %i は %s → %s に変換する", async (status, type, kind) => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonError(status, type));
    const error = await streamError(fetchMock);

    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
    // エラーに API キーを含めない
    expect(`${error.message} ${String(error)} ${JSON.stringify(error)}`).not.toContain(DUMMY_KEY);
  });

  it("自動リトライは SDK 既定（最大 2 回）を超えない", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonError(429, "rate_limit_error"));
    await streamError(fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("ストリーム途中のエラーイベントは overloaded に変換する", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      sse([{ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }]),
    );
    expect((await streamError(fetchMock)).kind).toBe("overloaded");
  });

  it("接続できなければ network", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect((await streamError(fetchMock)).kind).toBe("network");
  }, 10_000);

  it("停止（AbortSignal）で中断すると aborted", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>(async () => messageStream(["a", "b", "c"]));
    const provider = createAnthropicProvider({ fetch: fetchMock });

    const received: StreamEvent[] = [];
    const error = await (async () => {
      try {
        for await (const event of provider.stream(
          DUMMY_KEY,
          request({ signal: controller.signal }),
        )) {
          received.push(event);
          controller.abort();
        }
      } catch (error) {
        return error;
      }
    })();

    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).kind).toBe("aborted");
    expect(received).toEqual([{ type: "text", text: "a" }]);
  });
});

describe("AnthropicProvider.listModels / verifyKey", () => {
  const models = () =>
    new Response(
      JSON.stringify({
        data: [
          {
            type: "model",
            id: "claude-opus-5",
            display_name: "Claude Opus 5",
            created_at: "2026-01-01T00:00:00Z",
            max_input_tokens: 1_000_000,
            max_tokens: 128_000,
          },
          {
            type: "model",
            id: "claude-legacy",
            display_name: "Legacy",
            created_at: "2024-01-01T00:00:00Z",
            max_input_tokens: null,
            max_tokens: null,
          },
        ],
        has_more: false,
        first_id: "claude-opus-5",
        last_id: "claude-legacy",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  it("モデル ID と入出力の上限を返す（不明な上限は undefined）", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => models());
    expect(await createAnthropicProvider({ fetch: fetchMock }).listModels(DUMMY_KEY)).toEqual([
      { id: "claude-opus-5", maxInputTokens: 1_000_000, maxOutputTokens: 128_000 },
      { id: "claude-legacy", maxInputTokens: undefined, maxOutputTokens: undefined },
    ]);
  });

  it("キーが無効なら auth エラー", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonError(401, "authentication_error"));
    await expect(
      createAnthropicProvider({ fetch: fetchMock }).verifyKey(DUMMY_KEY),
    ).rejects.toMatchObject({ kind: "auth" });
  });
});
