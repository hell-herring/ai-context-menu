import type { Page } from "@playwright/test";
import { coreSettings, type ExtensionHelpers, expect, TEST_KEYS, test } from "./fixtures";

// 最近の要約（docs/spec.md §3.4。storage.session にこのブラウザを閉じるまで最大 10 件）

/** `title` のページを要約し、完了するまで待つ */
async function summarize(
  extension: ExtensionHelpers,
  panel: Page,
  title: string,
  text = `${title}の本文`,
): Promise<Page> {
  const page = await extension.openPage(
    `/page?title=${encodeURIComponent(title)}&text=${encodeURIComponent(text)}`,
  );
  await extension.clickMenu(page);
  await expect(panel.locator("main > section p").first()).toHaveText(title);
  await expect(panel.getByText("完了しました")).toBeVisible();
  return page;
}

async function recentKeys(extension: ExtensionHelpers): Promise<string[]> {
  return Object.keys(await extension.readStorage("session")).filter((key) =>
    key.startsWith("recent."),
  );
}

test.describe("最近の要約", () => {
  test.beforeEach(async ({ extension }) => {
    await extension.seed({ local: TEST_KEYS.anthropic, sync: coreSettings() });
  });

  test("前の結果を一覧から表示し、戻れる（送信はしない）", async ({ extension }) => {
    const panel = await extension.openSidePanel();
    const pageA = await summarize(extension, panel, "記事A");
    // 表示中のジョブの結果は一覧に出さない
    await expect(panel.getByText(/^最近の要約/)).toHaveCount(0);

    await summarize(extension, panel, "記事B");
    await panel.getByText("最近の要約（1 件）").click();
    await panel.getByRole("button", { name: /記事A/ }).click();

    await expect(panel.getByRole("button", { name: "戻る" })).toBeVisible();
    await expect(panel.locator("main > section p").first()).toHaveText("記事A");
    await expect(
      panel.getByText(/ページ本文 · Anthropic · claude-opus-5 · 要約する/),
    ).toBeVisible();
    await expect(panel.getByRole("heading", { name: "モック要約" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "再生成" })).toHaveCount(0);
    expect(await extension.requests(panel)).toHaveLength(2);

    // 結果だけを保存し、送った本文は保存しない
    const session = await extension.readStorage("session");
    expect(await recentKeys(extension)).toHaveLength(2);
    expect(JSON.stringify(session)).not.toContain("記事Aの本文");

    await panel.getByRole("button", { name: "戻る" }).click();
    await expect(panel.locator("main > section p").first()).toHaveText("記事B");
    await expect(panel.getByRole("button", { name: "再生成" })).toBeVisible();

    // 前の結果を表示中に新しいジョブを受け取ったら、新しいジョブの表示に戻す
    await panel.getByRole("button", { name: /記事A/ }).click();
    await expect(panel.getByRole("button", { name: "戻る" })).toBeVisible();
    await extension.clickMenu(pageA);
    await expect(panel.getByRole("button", { name: "戻る" })).toHaveCount(0);
    await expect(panel.getByText("完了しました")).toBeVisible();
    expect(await extension.requests(panel)).toHaveLength(3);
  });

  test("停止・エラーの結果は残さず、再生成した結果は置き換える", async ({ extension }) => {
    const panel = await extension.openSidePanel();

    const slow = await extension.openPage("/page?title=長い応答&text=E2E_SLOW");
    await extension.clickMenu(slow);
    await expect(panel.getByText("チャンク2")).toBeVisible();
    await panel.getByRole("button", { name: "停止" }).click();
    await expect(panel.getByText("停止しました")).toBeVisible();

    const failing = await extension.openPage("/page?title=エラー&text=E2E_ERROR:rate_limit");
    await extension.clickMenu(failing);
    await expect(panel.getByText("レート制限に達しました")).toBeVisible();

    await summarize(extension, panel, "記事C");
    expect(await recentKeys(extension)).toHaveLength(1);
    await expect(panel.getByText(/^最近の要約/)).toHaveCount(0);

    await panel.getByLabel("プリセット").selectOption("bullets");
    await panel.getByRole("button", { name: "再生成" }).click();
    await expect(panel.getByText("完了しました")).toBeVisible();
    expect(await recentKeys(extension)).toHaveLength(1);

    await summarize(extension, panel, "記事D");
    await panel.getByText("最近の要約（1 件）").click();
    await expect(panel.getByRole("button", { name: /記事C.*要点を箇条書き/ })).toBeVisible();
  });

  test("すべて削除できる", async ({ extension }) => {
    const panel = await extension.openSidePanel();
    await summarize(extension, panel, "記事E");
    await summarize(extension, panel, "記事F");
    await panel.getByText("最近の要約（1 件）").click();
    await panel.getByRole("button", { name: "すべて削除" }).click();

    await expect(panel.getByText(/^最近の要約/)).toHaveCount(0);
    expect(await recentKeys(extension)).toEqual([]);
    // 表示中の結果はそのまま
    await expect(panel.getByRole("heading", { name: "モック要約" })).toBeVisible();
  });
});
