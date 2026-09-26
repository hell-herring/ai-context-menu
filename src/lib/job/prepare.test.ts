import { describe, expect, it, vi } from "vitest";
import type { PageExtraction } from "../extract/page";
import type { SelectionExtraction } from "../extract/selection";
import type { JobContext } from "./create";
import { type ClickTarget, type PrepareJobDeps, prepareJob } from "./prepare";

const context: JobContext = {
  id: "00000000-0000-4000-8000-000000000000",
  windowId: 1,
  seq: 1,
  createdAt: 1_000,
  presetId: "summary",
  pageUrl: "https://example.com/article?token=secret",
  frameUrl: undefined,
};

const pageTarget: ClickTarget = {
  tabId: 10,
  tabTitle: "タブのタイトル",
  frameId: 0,
  editable: false,
  selectionText: undefined,
};

const selectionTarget: ClickTarget = { ...pageTarget, selectionText: "選択 テキスト" };

const page: PageExtraction = {
  title: "記事",
  url: "https://example.com/article?token=secret",
  text: "ページ本文",
  method: "readability",
  originalLength: 5,
};

const selection: SelectionExtraction = {
  title: "記事",
  url: "https://example.com/article?token=secret",
  text: "選択\nテキスト",
  originalLength: 7,
  editable: false,
};

function createDeps(runScript: PrepareJobDeps["runScript"]) {
  return {
    runScript: vi.fn(runScript),
    getMaxInputChars: vi.fn(async () => 50_000),
    getExcludedDomains: vi.fn(async (): Promise<string[]> => []),
  } satisfies PrepareJobDeps;
}

describe("prepareJob", () => {
  it.each([
    ["ページ URL", context],
    [
      "フレーム URL",
      { ...context, pageUrl: "https://news.example/", frameUrl: "https://example.com/" },
    ],
  ])("%s が除外ドメインに一致したらスクリプトを注入せずエラーにする", async (_label, ctx) => {
    const deps = createDeps(async () => page);
    deps.getExcludedDomains.mockResolvedValue(["*.example.com"]);
    const job = await prepareJob(selectionTarget, ctx, deps);

    expect(job).toMatchObject({ kind: "error", error: "excludedDomain" });
    expect(JSON.stringify(job)).not.toContain("選択 テキスト");
    expect(deps.runScript).not.toHaveBeenCalled();
  });

  it("クリック後に除外ドメインへ遷移していたら、取得した内容を送らない", async () => {
    const deps = createDeps(async () => ({ ...page, url: "https://login.bank.example/" }));
    deps.getExcludedDomains.mockResolvedValue(["*.bank.example"]);
    const job = await prepareJob(pageTarget, context, deps);

    expect(job).toMatchObject({ kind: "error", error: "excludedDomain" });
    expect(JSON.stringify(job)).not.toContain("ページ本文");
  });

  describe("URL にホスト名がないフレーム（about:srcdoc 等）", () => {
    const opaque = { ...context, pageUrl: "https://news.example/", frameUrl: "about:srcdoc" };
    const origins = [
      "https://login.bank.example",
      "https://login.bank.example",
      "https://news.example",
    ];
    const dispatch =
      (originsResult: unknown): PrepareJobDeps["runScript"] =>
      async (file) =>
        file === "/extract-origins.js" ? originsResult : { ...page, url: "about:srcdoc" };

    it("コンテンツの取得より前に実際のオリジン・祖先オリジンで判定し、一致したら取得しない", async () => {
      const deps = createDeps(dispatch(origins));
      deps.getExcludedDomains.mockResolvedValue(["*.bank.example"]);
      const job = await prepareJob(pageTarget, opaque, deps);

      expect(job).toMatchObject({ kind: "error", error: "excludedDomain" });
      expect(deps.runScript).toHaveBeenCalledExactlyOnceWith("/extract-origins.js", {
        tabId: 10,
        frameId: 0,
      });
    });

    it("一致しなければ取得し、送信直前の判定用にオリジンのホスト名をジョブに保存する", async () => {
      const deps = createDeps(dispatch(origins));
      deps.getExcludedDomains.mockResolvedValue(["intranet.example"]);
      const job = await prepareJob(pageTarget, opaque, deps);

      expect(job).toMatchObject({ kind: "content" });
      expect(job.hostnames).toEqual(["news.example", "login.bank.example"]);
      expect(deps.runScript.mock.calls.map(([file]) => file)).toEqual([
        "/extract-origins.js",
        "/extract.js",
      ]);
    });

    it.each([
      ["注入に失敗", () => Promise.reject(new Error("Cannot access"))],
      ["不正な戻り値", async () => ({ origin: 1 })],
      [
        "祖先オリジンが上限を超える",
        async () => Array.from({ length: 40 }, (_, i) => `https://a${i}.example`),
      ],
    ])("オリジンを確認できなければ（%s）取得しない", async (_label, runScript) => {
      const deps = createDeps(runScript);
      const job = await prepareJob(selectionTarget, opaque, deps);
      expect(job).toMatchObject({ kind: "error", error: "unreadablePage" });
      expect(deps.runScript).toHaveBeenCalledOnce();
    });
  });

  it("除外ドメインに一致しなければ取得する", async () => {
    const deps = createDeps(async () => page);
    deps.getExcludedDomains.mockResolvedValue(["bank.example"]);
    expect(await prepareJob(pageTarget, context, deps)).toMatchObject({ kind: "content" });
  });

  it("入力欄内のクリックはスクリプトを注入せずエラーにする", async () => {
    const deps = createDeps(async () => page);
    const job = await prepareJob({ ...selectionTarget, editable: true }, context, deps);

    expect(job).toMatchObject({ kind: "error", error: "editable" });
    expect(deps.runScript).not.toHaveBeenCalled();
  });

  describe("選択なし（ページ本文）", () => {
    it("クリックされたフレームに本文抽出スクリプトを注入する", async () => {
      const deps = createDeps(async () => page);
      const job = await prepareJob({ ...pageTarget, frameId: 3 }, context, deps);

      expect(deps.runScript).toHaveBeenCalledExactlyOnceWith("/extract.js", {
        tabId: 10,
        frameId: 3,
      });
      expect(job).toMatchObject({
        kind: "content",
        source: {
          type: "page",
          method: "readability",
          text: "ページ本文",
          providerUrl: "https://example.com/article",
        },
      });
    });

    it.each([
      ["注入に失敗", () => Promise.reject(new Error("Cannot access a chrome:// URL"))],
      ["不正な戻り値", async () => ({ text: 1 })],
    ])("%s したら読み取れないページとして扱う", async (_label, runScript) => {
      const job = await prepareJob(pageTarget, context, createDeps(runScript));
      expect(job).toMatchObject({ kind: "error", error: "unreadablePage" });
    });

    it("タブが分からなければ読み取れないページとして扱う", async () => {
      const deps = createDeps(async () => page);
      const job = await prepareJob({ ...pageTarget, tabId: undefined }, context, deps);
      expect(job).toMatchObject({ kind: "error", error: "unreadablePage" });
      expect(deps.runScript).not.toHaveBeenCalled();
    });

    it("本文が空ならエラーにする", async () => {
      const job = await prepareJob(
        pageTarget,
        context,
        createDeps(async () => ({ ...page, text: " \n", originalLength: 2 })),
      );
      expect(job).toMatchObject({ kind: "error", error: "emptyContent" });
    });

    it("設定の最大入力文字数を超えたら切り詰めて oversize にする", async () => {
      const deps = createDeps(async () => ({
        ...page,
        text: "a".repeat(2_000),
        originalLength: 2_000,
      }));
      deps.getMaxInputChars.mockResolvedValue(1_000);
      const job = await prepareJob(pageTarget, context, deps);
      expect(job).toMatchObject({
        kind: "content",
        source: { oversize: true, originalLength: 2_000, inputLimit: 1_000 },
      });
    });
  });

  describe("選択あり", () => {
    it("選択テキスト取得スクリプトの結果（改行を保持）を使い、ページ本文は取得しない", async () => {
      const deps = createDeps(async () => selection);
      const job = await prepareJob(selectionTarget, context, deps);

      expect(deps.runScript).toHaveBeenCalledExactlyOnceWith("/extract-selection.js", {
        tabId: 10,
        frameId: 0,
      });
      expect(job).toMatchObject({
        kind: "content",
        source: {
          type: "selection",
          method: "selection",
          title: "記事",
          text: "選択\nテキスト",
          providerUrl: "https://example.com/article",
        },
      });
    });

    it("スクリプトが入力欄・編集可能要素での選択と判定したら、フォールバックせず拒否する", async () => {
      const deps = createDeps(async () => ({ ...selection, text: "", editable: true }));
      const job = await prepareJob(selectionTarget, context, deps);
      expect(job).toMatchObject({ kind: "error", error: "editable" });
      expect(JSON.stringify(job)).not.toContain("選択 テキスト");
    });

    it.each([
      ["注入に失敗（PDF ビューア等）", () => Promise.reject(new Error("Cannot access"))],
      ["不正な戻り値", async () => "broken"],
      ["選択を読めない", async () => ({ ...selection, text: "", originalLength: 0 })],
    ])("%s した場合は info.selectionText にフォールバックする", async (_label, runScript) => {
      const job = await prepareJob(
        selectionTarget,
        { ...context, frameUrl: "https://frame.example/doc.pdf?sig=1" },
        createDeps(runScript),
      );
      expect(job).toMatchObject({
        kind: "content",
        source: {
          type: "selection",
          method: "selection",
          title: "タブのタイトル",
          text: "選択 テキスト",
          displayUrl: "https://frame.example/doc.pdf?sig=1",
          providerUrl: "https://frame.example/doc.pdf",
        },
      });
    });

    it("フレーム URL がなければページ URL を使う", async () => {
      const job = await prepareJob(
        { ...selectionTarget, tabId: undefined },
        context,
        createDeps(async () => selection),
      );
      expect(job).toMatchObject({
        kind: "content",
        source: { displayUrl: context.pageUrl, text: "選択 テキスト" },
      });
    });

    it("空白だけの選択はエラーにする", async () => {
      const job = await prepareJob(
        { ...selectionTarget, selectionText: "  " },
        context,
        createDeps(async () => ({ ...selection, text: "  ", originalLength: 2 })),
      );
      expect(job).toMatchObject({ kind: "error", error: "emptyContent" });
    });
  });
});
