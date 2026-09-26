import { coreSettings, expect, TEST_KEYS, test } from "./fixtures";

// 設定画面（docs/spec.md §3.6）

test.describe("設定画面", () => {
  test("API キーを保存し、接続テスト・モデルの保存ができる", async ({ extension }) => {
    const options = await extension.openOptions();
    const section = options.getByRole("region", { name: "Anthropic（Claude）" });

    await section.getByLabel("API キー").fill("sk-ant-e2e-dummy-1234");
    await section.getByRole("button", { name: "保存" }).first().click();
    await expect(section.getByText("保存済み: ••••1234")).toBeVisible();

    await section.getByRole("button", { name: "接続テスト" }).click();
    await expect(section.getByText("接続できました")).toBeVisible();

    await section.getByRole("button", { name: "モデル一覧を取得" }).click();
    await expect(section.getByText("2 件のモデルを取得しました")).toBeVisible();
    await section.getByLabel("モデル", { exact: true }).fill("claude-e2e-small");
    await section.getByRole("button", { name: "保存" }).last().click();
    await expect(section.getByText(/このモデルの出力上限は 1,000 トークン/)).toBeVisible();

    // キーは storage.local のみに置き、同期される設定にはモデルの上限を記録する
    expect(await extension.readStorage("local")).toMatchObject({
      "secrets.anthropic.apiKey": "sk-ant-e2e-dummy-1234",
    });
    const sync = await extension.readStorage("sync");
    expect(JSON.stringify(sync)).not.toContain("sk-ant-e2e-dummy-1234");
    expect(sync["settings.core"]).toMatchObject({
      models: { anthropic: "claude-e2e-small" },
      modelLimits: {
        anthropic: { model: "claude-e2e-small", maxInputTokens: 1_500, maxOutputTokens: 1_000 },
      },
    });
  });

  test("無効なキーは接続テストで理由を表示する", async ({ extension }) => {
    await extension.seed({ local: { "secrets.anthropic.apiKey": "sk-ant-invalid" } });
    const options = await extension.openOptions();
    const section = options.getByRole("region", { name: "Anthropic（Claude）" });

    await section.getByRole("button", { name: "接続テスト" }).click();
    await expect(section.getByText("API キーが無効か、権限がありません")).toBeVisible();
  });

  test("モデルの出力上限を超える最大出力トークンは保存しない", async ({ extension }) => {
    await extension.seed({
      local: TEST_KEYS.anthropic,
      sync: coreSettings({
        models: { anthropic: "claude-e2e-small", openai: "gpt-6-sol" },
        modelLimits: { anthropic: { model: "claude-e2e-small", maxOutputTokens: 1_000 } },
        maxOutputTokens: 1_000,
      }),
    });
    const options = await extension.openOptions();
    const section = options.getByRole("region", { name: "要約の設定" });

    await section.getByLabel("最大出力トークン").fill("2000");
    await section.getByRole("button", { name: "保存" }).click();
    await expect(
      section.getByText(/claude-e2e-small の出力上限（1,000）を超えています/),
    ).toBeVisible();
    expect((await extension.readStorage("sync"))["settings.core"]).toMatchObject({
      maxOutputTokens: 1_000,
    });
  });
});
