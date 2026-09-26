import { describe, expect, it, vi } from "vitest";
import { createOpenAIProvider, isTextGenerationModel } from "./openai";
import { ProviderError, type StreamEvent, type SummarizeRequest } from "./types";

// 実 API は呼ばない。SDK に fetch を差し替えてレスポンスをモックする（docs/guardrails.md §5）
const DUMMY_KEY = "sk-test-dummy";

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

function sse(events: Record<string, unknown>[]): Response {
  const body = events
    .map((event, index) => {
      const data = { sequence_number: index, ...event };
      return `event: ${String(event.type)}\ndata: ${JSON.stringify(data)}\n\n`;
    })
    .join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function responseObject(overrides: Record<string, unknown> = {}) {
  return {
    id: "resp_test",
    object: "response",
    created_at: 0,
    model: "gpt-6-sol",
    status: "completed",
    output: [],
    incomplete_details: null,
    error: null,
    usage: {
      input_tokens: 12,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 34,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 46,
    },
    ...overrides,
  };
}

function textDelta(delta: string) {
  return {
    type: "response.output_text.delta",
    item_id: "msg_test",
    output_index: 0,
    content_index: 0,
    delta,
    logprobs: [],
  };
}

function responseStream(texts: string[], final = { type: "response.completed" }) {
  return sse([
    { type: "response.created", response: responseObject({ status: "in_progress", usage: null }) },
    ...texts.map(textDelta),
    { response: responseObject(), ...final },
  ]);
}

function jsonError(status: number, code: string): Response {
  return new Response(
    JSON.stringify({ error: { message: "test error", type: "error", param: null, code } }),
    {
      status,
      // SDK の自動リトライを待たずに済むよう、再試行までの待ち時間を最小にする
      headers: { "content-type": "application/json", "retry-after-ms": "1" },
    },
  );
}

function request(overrides: Partial<SummarizeRequest> = {}): SummarizeRequest {
  return {
    system: "system prompt",
    userContent: "user content",
    model: "gpt-6-sol",
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
  const provider = createOpenAIProvider({ fetch: fetchMock });
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
  return {
    url: String(input),
    headers: new Headers(init?.headers),
    body: JSON.parse(String(init?.body)) as Record<string, unknown>,
  };
}

describe("OpenAIProvider.stream", () => {
  it("テキストを逐次返し、最後に終了理由と使用量を返す", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => responseStream(["要約", "です"]));
    const provider = createOpenAIProvider({ fetch: fetchMock });

    expect(await collect(provider.stream(DUMMY_KEY, request()))).toEqual([
      { type: "text", text: "要約" },
      { type: "text", text: "です" },
      { type: "done", stopReason: "end", usage: { inputTokens: 12, outputTokens: 34 } },
    ]);
  });

  it("公式ホストの Responses API に、保存させない設定と既知モデル向けの推論設定を付けて送る", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => responseStream(["ok"]));
    await collect(createOpenAIProvider({ fetch: fetchMock }).stream(DUMMY_KEY, request()));

    const { url, headers, body } = sentRequest(fetchMock);
    expect(new URL(url).origin).toBe("https://api.openai.com");
    expect(new URL(url).pathname).toBe("/v1/responses");
    expect(headers.get("authorization")).toBe(`Bearer ${DUMMY_KEY}`);
    expect(headers.get("openai-organization")).toBeNull();
    expect(headers.get("openai-project")).toBeNull();
    expect(body).toEqual({
      model: "gpt-6-sol",
      instructions: "system prompt",
      input: "user content",
      max_output_tokens: 8_000,
      store: false,
      stream: true,
      reasoning: { effort: "low" },
    });
  });

  it("許可リストにないモデルにはモデル依存パラメータを付けない", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => responseStream(["ok"]));
    await collect(
      createOpenAIProvider({ fetch: fetchMock }).stream(DUMMY_KEY, request({ model: "gpt-4.1" })),
    );

    const { body } = sentRequest(fetchMock);
    expect(body).not.toHaveProperty("reasoning");
    expect(body).toMatchObject({ model: "gpt-4.1", store: false });
  });

  it.each([
    ["max_output_tokens", "max_tokens"],
    ["content_filter", "refusal"],
  ])("incomplete（%s）→ %s", async (reason, expected) => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      sse([
        textDelta("途中"),
        {
          type: "response.incomplete",
          response: responseObject({ status: "incomplete", incomplete_details: { reason } }),
        },
      ]),
    );
    const events = await collect(
      createOpenAIProvider({ fetch: fetchMock }).stream(DUMMY_KEY, request()),
    );
    expect(events).toEqual([
      { type: "text", text: "途中" },
      { type: "done", stopReason: expected, usage: { inputTokens: 12, outputTokens: 34 } },
    ]);
  });

  it("モデルが拒否した場合（refusal）は refusal で終わる", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      sse([
        {
          type: "response.refusal.delta",
          item_id: "msg_test",
          output_index: 0,
          content_index: 0,
          delta: "I can't help with that.",
        },
        { type: "response.completed", response: responseObject() },
      ]),
    );
    const events = await collect(
      createOpenAIProvider({ fetch: fetchMock }).stream(DUMMY_KEY, request()),
    );
    expect(events).toEqual([
      { type: "done", stopReason: "refusal", usage: { inputTokens: 12, outputTokens: 34 } },
    ]);
  });

  it.each([
    [401, "invalid_api_key", "auth"],
    [403, "unsupported_country_region_territory", "auth"],
    [429, "rate_limit_exceeded", "rate_limit"],
    [500, "server_error", "overloaded"],
    [503, "server_error", "overloaded"],
    [400, "context_length_exceeded", "bad_request"],
    [404, "model_not_found", "bad_request"],
  ])("HTTP %i（%s）→ %s に変換する", async (status, code, kind) => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonError(status, code));
    const error = await streamError(fetchMock);

    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
    // エラーに API キーを含めない
    expect(`${error.message} ${String(error)} ${JSON.stringify(error)}`).not.toContain(DUMMY_KEY);
  });

  it("自動リトライは SDK 既定（最大 2 回）を超えない", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonError(429, "rate_limit_exceeded"));
    await streamError(fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["server_error", "overloaded"],
    ["rate_limit_exceeded", "rate_limit"],
    ["invalid_prompt", "bad_request"],
  ])("response.failed（%s）→ %s", async (code, kind) => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      sse([
        textDelta("途中"),
        {
          type: "response.failed",
          response: responseObject({ status: "failed", error: { code, message: "failed" } }),
        },
      ]),
    );
    expect((await streamError(fetchMock)).kind).toBe(kind);
  });

  it("ストリーム途中の error イベントは overloaded に変換する", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      sse([{ type: "error", code: "server_error", message: "Overloaded", param: null }]),
    );
    expect((await streamError(fetchMock)).kind).toBe("overloaded");
  });

  it("終了イベントの前にストリームが閉じたら network", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => sse([textDelta("途中")]));
    expect((await streamError(fetchMock)).kind).toBe("network");
  });

  it("接続できなければ network", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect((await streamError(fetchMock)).kind).toBe("network");
  }, 10_000);

  it("停止（AbortSignal）で中断すると aborted", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>(async () => responseStream(["a", "b", "c"]));
    const provider = createOpenAIProvider({ fetch: fetchMock });

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

describe("OpenAIProvider.listModels / verifyKey", () => {
  const models = (ids: string[]) =>
    new Response(
      JSON.stringify({
        object: "list",
        data: ids.map((id) => ({ id, object: "model", created: 0, owned_by: "openai" })),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  it("テキスト生成に使えるモデルだけを返す", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      models([
        "text-embedding-3-large",
        "gpt-6-sol",
        "gpt-realtime-2",
        "gpt-4o-mini-audio-preview",
        "gpt-image-2.5",
        "omni-moderation-latest",
        "gpt-6-luna",
        "whisper-1",
      ]),
    );
    expect(await createOpenAIProvider({ fetch: fetchMock }).listModels(DUMMY_KEY)).toEqual([
      "gpt-6-luna",
      "gpt-6-sol",
    ]);
  });

  it("キーが無効なら auth エラー", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonError(401, "invalid_api_key"));
    await expect(
      createOpenAIProvider({ fetch: fetchMock }).verifyKey(DUMMY_KEY),
    ).rejects.toMatchObject({ kind: "auth" });
  });
});

describe("isTextGenerationModel", () => {
  it.each([
    "gpt-6-astra",
    "gpt-6-sol",
    "gpt-6-luna",
    "gpt-5.6-terra",
    "gpt-5.5-2026-04-23",
    "gpt-5.4-mini",
    "gpt-5-chat-latest",
    "gpt-4.1-nano",
    "gpt-4o",
    "gpt-4o-mini",
    "o3",
    "o4-mini",
  ])("%s は対象", (id) => {
    expect(isTextGenerationModel(id)).toBe(true);
  });

  it.each([
    "text-embedding-3-small",
    "gpt-image-2.5",
    "gpt-4o-audio-preview",
    "gpt-4o-mini-transcribe",
    "gpt-4o-mini-tts",
    "gpt-realtime-2",
    "gpt-4o-search-preview",
    "gpt-5.1-codex",
    "gpt-5.2-pro",
    "o3-deep-research",
    "omni-moderation-latest",
    "gpt-3.5-turbo-instruct",
    "gpt-4-32k",
    "dall-e-3",
    "whisper-1",
    "sora-2",
  ])("%s は対象外", (id) => {
    expect(isTextGenerationModel(id)).toBe(false);
  });
});
