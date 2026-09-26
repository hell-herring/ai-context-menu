import { coreSettings, expect, TEST_KEYS, test } from "./fixtures";

// メニュー → サイドパネル → 結果表示（docs/tech-stack.md §6 E2E）

const bothKeys = { ...TEST_KEYS.anthropic, ...TEST_KEYS.openai };

test.describe("要約", () => {
  test("ページ本文を要約してストリーミング表示する", async ({ extension }) => {
    await extension.seed({ local: TEST_KEYS.anthropic, sync: coreSettings() });
    const page = await extension.openPage("/article.html?token=SECRET_QUERY#SECRET_HASH");
    const panel = await extension.openSidePanel();
    await expect(panel.getByText("ページ上で右クリックし")).toBeVisible();

    await extension.clickMenu(page);

    // 何を送ったかを表示する
    await expect(panel.getByText("テスト記事 - Example News")).toBeVisible();
    await expect(panel.getByText(/ページ本文 · [\d,]+ 文字/)).toBeVisible();
    await expect(panel.getByRole("heading", { name: "モック要約" })).toBeVisible();
    await expect(panel.getByText("完了しました")).toBeVisible();

    expect(await extension.requests(panel)).toHaveLength(1);
    const { provider, request } = await extension.lastRequest(panel);
    expect(provider).toBe("anthropic");
    expect(request.model).toBe("claude-opus-5");
    expect(request.userContent).toContain("テスト記事の見出し");
    // URL は origin + pathname のみ
    expect(request.userContent).toContain("/article.html");
    expect(request.userContent).not.toContain("SECRET_QUERY");
    expect(request.userContent).not.toContain("SECRET_HASH");
    // 非表示要素・フォームの値・スクリプトは送らない
    for (const hidden of [
      "INLINE_HIDDEN",
      "CLASS_HIDDEN",
      "ATTR_HIDDEN",
      "VISIBILITY_HIDDEN",
      "INPUT_VALUE",
      "TEXTAREA_VALUE",
      "EDITABLE_DRAFT",
      "SCRIPT_CONTENT",
    ]) {
      expect(request.userContent).not.toContain(hidden);
    }
  });

  test("AI の出力の生 HTML・javascript: リンクを描画しない", async ({ extension }) => {
    await extension.seed({ local: TEST_KEYS.anthropic, sync: coreSettings() });
    const page = await extension.openPage("/article.html");
    const panel = await extension.openSidePanel();
    await extension.clickMenu(page);
    await expect(panel.getByText("完了しました")).toBeVisible();

    const main = panel.locator("main");
    await expect(main.locator("img")).toHaveCount(0);
    await expect(main.locator('a[href^="javascript:"]')).toHaveCount(0);
    await expect(main.getByRole("link", { name: "安全なリンク" })).toHaveAttribute(
      "href",
      "https://example.com/",
    );
    expect(await panel.title()).not.toBe("XSS");
  });

  test("選択テキストを選んだプリセットで要約する", async ({ extension }) => {
    await extension.seed({ local: TEST_KEYS.anthropic, sync: coreSettings() });
    const page = await extension.openPage("/article.html");
    await page.evaluate(() => {
      const heading = document.querySelector("h1");
      const range = document.createRange();
      range.selectNodeContents(heading as Node);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    });
    const panel = await extension.openSidePanel();

    await extension.clickMenu(page, "tldr3");

    await expect(panel.getByText(/選択テキスト · 9 文字/)).toBeVisible();
    await expect(panel.getByText("完了しました")).toBeVisible();
    const { request } = await extension.lastRequest(panel);
    expect(request.userContent).toContain("テスト記事の見出し");
    expect(request.userContent).not.toContain("最初の段落です");
    expect(request.userContent).toContain("3行以内");
  });

  test("停止するとリクエストを中断する", async ({ extension }) => {
    await extension.seed({ local: TEST_KEYS.anthropic, sync: coreSettings() });
    const page = await extension.openPage("/page?title=長い応答&text=E2E_SLOW");
    const panel = await extension.openSidePanel();
    await extension.clickMenu(page);

    await expect(panel.getByText("チャンク2")).toBeVisible();
    await panel.getByRole("button", { name: "停止" }).click();

    await expect(panel.getByText("停止しました")).toBeVisible();
    await expect(panel.getByRole("button", { name: "再生成" })).toBeVisible();
  });

  test("プロバイダのエラーを表示する", async ({ extension }) => {
    await extension.seed({ local: TEST_KEYS.anthropic, sync: coreSettings() });
    const page = await extension.openPage("/page?title=エラー&text=E2E_ERROR:rate_limit");
    const panel = await extension.openSidePanel();
    await extension.clickMenu(page);

    await expect(panel.getByText("レート制限に達しました")).toBeVisible();
  });

  test("API キーがなければ送らずに設定を案内する", async ({ extension }) => {
    const page = await extension.openPage("/article.html");
    const panel = await extension.openSidePanel();
    await extension.clickMenu(page);

    await expect(panel.getByText("API キーを設定してください")).toBeVisible();
    await expect(panel.getByRole("button", { name: "設定を開く" }).last()).toBeVisible();
    expect(await extension.requests(panel)).toEqual([]);
  });

  test("除外ドメインのページは取得・送信しない", async ({ extension }) => {
    await extension.seed({
      local: TEST_KEYS.anthropic,
      sync: {
        ...coreSettings(),
        "settings.excludedDomains": { version: 1, domains: ["localhost"] },
      },
    });
    const page = await extension.openPage("/article.html");
    const panel = await extension.openSidePanel();
    await extension.clickMenu(page);

    await expect(panel.getByText("このサイトは除外設定されています")).toBeVisible();
    await expect(panel.getByText("テスト記事 - Example News")).toHaveCount(0);
    expect(await extension.requests(panel)).toEqual([]);
  });
});

test.describe("送信前の確認", () => {
  test("上限を超える本文は確認してから切り詰めて送る", async ({ extension }) => {
    await extension.seed({
      local: TEST_KEYS.anthropic,
      sync: coreSettings({ maxInputChars: 1_000 }),
    });
    const text = "長い本文の段落です。";
    const page = await extension.openPage(`/page?title=長い記事&text=${text}&repeat=300`);
    const panel = await extension.openSidePanel();
    await extension.clickMenu(page);

    await expect(panel.getByText("送信内容が上限を超えています")).toBeVisible();
    expect(await extension.requests(panel)).toEqual([]);

    await panel.getByRole("button", { name: "先頭から上限まで送信" }).click();
    await expect(panel.getByText("完了しました")).toBeVisible();
    await expect(panel.getByText("本文を上限の 1,000 文字まで切り詰めて送信")).toBeVisible();
    const { request } = await extension.lastRequest(panel);
    expect(request.userContent).not.toContain(text.repeat(300));
  });

  test("キャンセルすると送らない", async ({ extension }) => {
    await extension.seed({
      local: TEST_KEYS.anthropic,
      sync: coreSettings({ confirmBeforeSend: "always" }),
    });
    const page = await extension.openPage("/article.html");
    const panel = await extension.openSidePanel();
    await extension.clickMenu(page);

    await expect(panel.getByText("この内容を AI に送信しますか？")).toBeVisible();
    await panel.getByRole("button", { name: "キャンセル" }).click();

    await expect(panel.getByText("送信をキャンセルしました")).toBeVisible();
    expect(await extension.requests(panel)).toEqual([]);
  });

  test("モデルの入力上限を超える場合は確認してから収まる長さで送る", async ({ extension }) => {
    await extension.seed({
      local: TEST_KEYS.anthropic,
      sync: coreSettings({
        models: { anthropic: "claude-e2e-small", openai: "gpt-6-sol" },
        modelLimits: {
          anthropic: { model: "claude-e2e-small", maxInputTokens: 1_500, maxOutputTokens: 1_000 },
        },
        maxOutputTokens: 1_000,
      }),
    });
    const page = await extension.openPage(
      "/page?title=長い記事&text=モデルに収まらない本文です。&repeat=200",
    );
    const panel = await extension.openSidePanel();
    await extension.clickMenu(page);

    await expect(
      panel.getByText(/選択中のモデル（claude-e2e-small）の入力上限に収まりません/),
    ).toBeVisible();
    expect(await extension.requests(panel)).toEqual([]);

    await panel.getByRole("button", { name: "モデルに収まる長さまで送信" }).click();
    await expect(panel.getByText("完了しました")).toBeVisible();
    await expect(panel.getByText(/本文を先頭から [\d,]+ 文字に短縮して送信しました/)).toBeVisible();
    const { request } = await extension.lastRequest(panel);
    expect(request.model).toBe("claude-e2e-small");
    expect(request.maxOutputTokens).toBe(1_000);
  });
});

test.describe("サイドパネルでの切り替え", () => {
  test("切り替えは再生成で反映し、設定は変えない", async ({ extension }) => {
    await extension.seed({ local: bothKeys, sync: coreSettings({ defaultProvider: "anthropic" }) });
    const page = await extension.openPage("/article.html");
    const panel = await extension.openSidePanel();
    await extension.clickMenu(page);
    await expect(panel.getByText("完了しました")).toBeVisible();

    await panel.getByLabel("AI", { exact: true }).selectOption("openai");
    await panel.getByLabel("プリセット").selectOption("bullets");
    await expect(
      panel.getByText("再生成すると、選んだ AI・モデル・プリセットで送信します"),
    ).toBeVisible();
    // 切り替えただけでは送らない
    expect(await extension.requests(panel)).toHaveLength(1);

    await panel.getByRole("button", { name: "再生成" }).click();
    await expect(panel.getByText("- プロバイダ: openai".slice(2))).toBeVisible();
    await expect(panel.getByText("完了しました")).toBeVisible();

    const requests = await extension.requests(panel);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.provider).toBe("openai");
    expect(requests[1]?.request.model).toBe("gpt-6-sol");
    expect(requests[1]?.request.userContent).toContain("5〜10個の箇条書き");

    const { "settings.core": settings } = await extension.readStorage("sync");
    expect(settings).toMatchObject({ defaultProvider: "anthropic" });

    // 次のジョブは設定のデフォルトに戻る
    await extension.clickMenu(page);
    await expect(panel.getByLabel("AI", { exact: true })).toHaveValue("anthropic");
    await expect(panel.getByLabel("プリセット")).toHaveValue("summary");
  });
});
