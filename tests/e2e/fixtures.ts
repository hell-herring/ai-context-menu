import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { type BrowserContext, test as base, chromium, expect, type Page } from "@playwright/test";

// E2E テストの共通処理。拡張（モックプロバイダ入りの E2E 用ビルド）を読み込んだ Chromium を
// テストごとに起動し、テスト用のページをローカルサーバーで配信する

export const EXTENSION_DIR = path.resolve(import.meta.dirname, "../../.output/chrome-mv3-e2e");

const OPTIONS_URL = /^chrome-extension:\/\/[a-p]{32}\/options\.html$/;

/** background のテスト用フックへのメッセージ（src/testing/e2e-background.ts と同じ値） */
const CLICK_MENU_MESSAGE = "__AICM_TEST_ONLY__clickMenu";

const ARTICLE_PATH = path.resolve(import.meta.dirname, "../fixtures/article.html");

/** モックプロバイダが受け取ったリクエスト（src/testing/mock-provider.ts） */
export interface MockRequest {
  provider: "anthropic" | "openai";
  request: { system: string; userContent: string; model: string; maxOutputTokens: number };
}

type PresetId = "summary" | "tldr3" | "bullets";

/** 拡張のページ内の `chrome`（`control.evaluate` の中でだけ使う） */
declare const chrome: {
  runtime: {
    sendMessage(message: unknown): Promise<{ ok: boolean; error?: string } | undefined>;
  };
  storage: Record<
    "local" | "sync",
    {
      get(keys: null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    }
  >;
};

interface Fixtures {
  context: BrowserContext;
  /** 拡張の API（ストレージ・メッセージ）を呼ぶための拡張のページ */
  control: Page;
  extensionId: string;
  /** 実 API のホストへのリクエスト（モックに差し替えているため、発生してはならない） */
  realApiRequests: string[];
  extension: ExtensionHelpers;
}

interface WorkerFixtures {
  /** テスト用ページのオリジン（`http://localhost:<port>`） */
  origin: string;
}

export interface ExtensionHelpers {
  /** ストレージに直接書き込む（API キー・設定の準備） */
  seed(items: { local?: Record<string, unknown>; sync?: Record<string, unknown> }): Promise<void>;
  readStorage(area: "local" | "sync"): Promise<Record<string, unknown>>;
  /** テスト用ページを開く */
  openPage(pathAndQuery: string): Promise<Page>;
  /** サイドパネルを開く（ネイティブのサイドパネルは操作できないため、同じウィンドウのタブで開く） */
  openSidePanel(): Promise<Page>;
  openOptions(): Promise<Page>;
  /** `page` でコンテキストメニューのプリセットを選んだときの処理を行う */
  clickMenu(page: Page, presetId?: PresetId): Promise<void>;
  /** サイドパネルのモックプロバイダが受け取ったリクエスト */
  requests(panel: Page): Promise<MockRequest[]>;
  /** サイドパネルのモックプロバイダが最後に受け取ったリクエスト（なければ失敗） */
  lastRequest(panel: Page): Promise<MockRequest>;
}

/** 本文を持つテスト用ページ（`/page?title=...&text=...&repeat=<text を繰り返す回数>`） */
function renderPage(title: string, text: string): string {
  const escapeHtml = (value: string) =>
    value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const paragraphs = text
    .split("\n")
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("\n");
  return `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title></head><body><main><article><h1>${escapeHtml(title)}</h1>${paragraphs}</article></main></body></html>`;
}

async function startServer(): Promise<{ server: Server; origin: string }> {
  const article = await readFile(ARTICLE_PATH, "utf8");
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (html: string) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    };
    if (url.pathname === "/article.html") {
      send(article);
    } else if (url.pathname === "/page") {
      const repeat = Number(url.searchParams.get("repeat") ?? "1");
      send(
        renderPage(
          url.searchParams.get("title") ?? "テスト",
          (url.searchParams.get("text") ?? "").repeat(repeat),
        ),
      );
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return { server, origin: `http://localhost:${port}` };
}

export const test = base.extend<Fixtures, WorkerFixtures>({
  origin: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright のフィクスチャは分割代入で依存を宣言する
    async ({}, use) => {
      const { server, origin } = await startServer();
      await use(origin);
      await new Promise((resolve) => server.close(resolve));
    },
    { scope: "worker" },
  ],

  // biome-ignore lint/correctness/noEmptyPattern: 同上
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      // ローカルでは PLAYWRIGHT_CHROMIUM_EXECUTABLE で既存の Chromium を使える（未指定なら Playwright の Chromium）
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
        : { channel: "chromium" }),
      headless: true,
      locale: "ja-JP",
      // chrome.i18n の UI 言語を日本語にする
      env: { ...process.env, LANGUAGE: "ja" },
      args: [
        "--lang=ja",
        `--disable-extensions-except=${EXTENSION_DIR}`,
        `--load-extension=${EXTENSION_DIR}`,
      ],
    });
    await use(context);
    await context.close();
  },

  realApiRequests: async ({ context }, use) => {
    const requests: string[] = [];
    // 万一モックが外れていても実 API に届かないよう遮断し、記録して検査する
    await context.route(/^https:\/\/api\.(anthropic|openai)\.com\//, (route) => {
      requests.push(route.request().url());
      return route.abort();
    });
    await use(requests);
    expect(requests).toEqual([]);
  },

  control: async ({ context }, use) => {
    // インストール時に background が開く設定画面を待ち、拡張の API を呼ぶページとして使う
    // （Playwright は拡張の Service Worker を検出できないことがあるため、Service Worker は直接操作しない）
    const isOptions = (page: Page) => OPTIONS_URL.test(page.url());
    await expect.poll(() => context.pages().some(isOptions), { timeout: 20_000 }).toBe(true);
    const page = context.pages().find(isOptions) as Page;
    await page.waitForLoadState();
    await use(page);
  },

  extensionId: async ({ control }, use) => {
    await use(new URL(control.url()).host);
  },

  extension: async ({ context, control, extensionId, origin, realApiRequests }, use) => {
    void realApiRequests;
    const helpers: ExtensionHelpers = {
      async seed({ local = {}, sync = {} }) {
        await control.evaluate(
          async ({ local, sync }) => {
            await chrome.storage.local.set(local);
            await chrome.storage.sync.set(sync);
          },
          { local, sync },
        );
      },
      readStorage: (area) => control.evaluate((area) => chrome.storage[area].get(null), area),
      async openPage(pathAndQuery) {
        const page = await context.newPage();
        await page.goto(`${origin}${pathAndQuery}`);
        return page;
      },
      async openSidePanel() {
        const panel = await context.newPage();
        await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
        return panel;
      },
      async openOptions() {
        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/options.html`);
        return page;
      },
      async clickMenu(page, presetId = "summary") {
        const message = { type: CLICK_MENU_MESSAGE, url: page.url(), presetId };
        // background のフック（src/testing/e2e-background.ts）は起動直後に非同期で登録されるため、
        // 受け取り手がいなければ待って送り直す
        await expect
          .poll(
            () =>
              control.evaluate(async (message) => {
                try {
                  const response = await chrome.runtime.sendMessage(message);
                  return response?.ok === true ? "ok" : `failed: ${response?.error}`;
                } catch (error) {
                  return `unreachable: ${error}`;
                }
              }, message),
            { timeout: 10_000 },
          )
          .toBe("ok");
      },
      requests: (panel) =>
        panel.evaluate(() => (globalThis.__AICM_TEST_ONLY__?.requests ?? []) as MockRequest[]),
      async lastRequest(panel) {
        const last = (await helpers.requests(panel)).at(-1);
        if (!last) {
          throw new Error("The mock provider received no requests");
        }
        return last;
      },
    };
    await use(helpers);
  },
});

export { expect };

/** Anthropic・OpenAI のテスト用 API キー（モックプロバイダにしか渡らない） */
export const TEST_KEYS = {
  anthropic: { "secrets.anthropic.apiKey": "sk-ant-e2e-dummy" },
  openai: { "secrets.openai.apiKey": "sk-e2e-dummy" },
} as const;

/** `settings.core` の既定値に上書きした値 */
export function coreSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "settings.core": {
      version: 1,
      models: { anthropic: "claude-opus-5", openai: "gpt-6-sol" },
      modelLimits: {},
      confirmBeforeSend: "oversize",
      outputLanguage: "ja",
      maxInputChars: 50_000,
      maxOutputTokens: 8_000,
      ...overrides,
    },
  };
}
