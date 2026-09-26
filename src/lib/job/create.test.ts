import { describe, expect, it } from "vitest";
import { urlHostname } from "../domain/exclude";
import { JobSchema } from "../storage/schema";
import {
  createContentJob,
  createErrorJob,
  createJobSource,
  type ExtractedContent,
  type JobContext,
  jobByteSize,
  jobHostname,
  limitUrl,
  toProviderUrl,
} from "./create";

const content: ExtractedContent = {
  type: "page",
  method: "readability",
  title: "タイトル",
  url: "https://user:pass@example.com/path/to?token=secret#frag",
  text: "本文",
  originalLength: 2,
};

const context: JobContext = {
  id: "00000000-0000-4000-8000-000000000000",
  windowId: 1,
  seq: 3,
  createdAt: 1_000,
  presetId: "summary",
  pageUrl: "https://example.com/path/to?token=secret",
  frameUrl: undefined,
};

describe("toProviderUrl", () => {
  it.each([
    ["https://user:pass@example.com/path/to?token=secret#frag", "https://example.com/path/to"],
    ["http://example.com:8080/", "http://example.com:8080/"],
    ["https://例え.jp/記事", "https://xn--r8jz45g.jp/%E8%A8%98%E4%BA%8B"],
    ["file:///Users/name/doc.html", ""],
    ["chrome://settings", ""],
    ["not a url", ""],
  ])("%s → %j", (url, expected) => {
    expect(toProviderUrl(url)).toBe(expected);
  });
});

describe("createJobSource", () => {
  it("上限内ならそのまま。送信用 URL は origin + pathname のみ", () => {
    expect(createJobSource(content, 1_000)).toEqual({
      type: "page",
      method: "readability",
      title: "タイトル",
      displayUrl: content.url,
      providerUrl: "https://example.com/path/to",
      hostname: "example.com",
      text: "本文",
      originalLength: 2,
      inputLimit: 1_000,
      oversize: false,
      oversizeReasons: [],
    });
  });

  it.each(["", "  \n\t "])("本文が空（%j）なら undefined", (text) => {
    expect(createJobSource({ ...content, text, originalLength: text.length }, 1_000)).toBe(
      undefined,
    );
  });

  it("XML エスケープ後の文字数で上限を判定し、上限に収まるよう切り詰めて oversize にする", () => {
    // 1,000 文字だがエスケープ後は 1,000 × 5 文字
    const text = "&".repeat(1_000);
    const source = createJobSource({ ...content, text, originalLength: text.length }, 1_000);
    expect(source).toMatchObject({
      text: "&".repeat(200),
      originalLength: 1_000,
      oversize: true,
      oversizeReasons: ["content"],
    });
  });

  it("抽出側で打ち切られていれば（originalLength > 本文）上限内でも oversize にする", () => {
    const source = createJobSource({ ...content, text: "abc", originalLength: 5 }, 1_000);
    expect(source).toMatchObject({ text: "abc", originalLength: 5, oversize: true });
  });

  it("長すぎるタイトル・URL は短縮し、理由に metadata を記録する", () => {
    const source = createJobSource(
      {
        ...content,
        title: "t".repeat(301),
        url: `https://example.com/${"p".repeat(5_000)}`,
      },
      1_000,
    );
    expect(source?.title).toHaveLength(300);
    expect(source?.displayUrl).toHaveLength(4_096);
    expect(source?.providerUrl).toHaveLength(2_048);
    expect(source?.oversize).toBe(true);
    expect(source?.oversizeReasons).toEqual(["metadata"]);
  });
});

describe("limitUrl", () => {
  const longCredentials = `https://${"u".repeat(5_000)}:pw@bank.example/path?q=1`;

  it("上限内ならそのまま返す（ユーザー情報も含めて変えない）", () => {
    expect(limitUrl("https://user:pass@example.com/", 100)).toBe("https://user:pass@example.com/");
  });

  it("ユーザー情報が長くて上限を超えても、ホスト名を失わない", () => {
    const limited = limitUrl(longCredentials, 4_096);
    expect(limited).toBe("https://bank.example/path?q=1");
    expect(urlHostname(limited)).toBe("bank.example");
  });

  it("超過したら onTruncate を呼ぶ", () => {
    let truncated = false;
    limitUrl(`https://example.com/${"p".repeat(100)}`, 50, () => {
      truncated = true;
    });
    expect(truncated).toBe(true);
  });

  it("filesystem: などに包まれた URL でも、上限超過時はユーザー情報を除いてホスト名を保つ", () => {
    const wrapped = `filesystem:https://${"u".repeat(5_000)}@bank.example/temporary/doc`;
    expect(limitUrl(wrapped, 4_096)).toBe("filesystem:https://bank.example/temporary/doc");
  });

  it("ジョブのページ URL・フレーム URL・表示用 URL でもホスト名を保つ", () => {
    const source = createJobSource({ ...content, url: longCredentials }, 1_000);
    const job = createErrorJob(
      { ...context, pageUrl: longCredentials, frameUrl: longCredentials },
      "editable",
    );
    expect(urlHostname(source?.displayUrl ?? "")).toBe("bank.example");
    expect(source?.oversizeReasons).toEqual(["metadata"]);
    expect(urlHostname(job.pageUrl)).toBe("bank.example");
    expect(urlHostname(job.frameUrl ?? "")).toBe("bank.example");
  });
});

describe("ジョブに保存する除外判定用のホスト名", () => {
  // 保存用に切り詰めた URL からはホスト名を読み直せない場合があるため、切り詰める前の URL から求めて保存する
  const wrapped = `filesystem:https://${"u".repeat(5_000)}@bank.example/temporary/doc`;

  it("切り詰める前のページ URL・フレーム URL・取得元 URL から求める", () => {
    const job = createErrorJob(
      { ...context, pageUrl: "https://news.example/", frameUrl: wrapped },
      "editable",
    );
    expect(job.hostnames).toEqual(["news.example", "bank.example"]);
    expect(createJobSource({ ...content, url: wrapped }, 1_000)?.hostname).toBe("bank.example");
  });

  it("ページ URL とフレーム URL が同じホストなら 1 つにまとめ、ホスト名のない URL は含めない", () => {
    expect(
      createErrorJob(
        { ...context, pageUrl: "https://a.example/1", frameUrl: "https://a.example/2" },
        "editable",
      ).hostnames,
    ).toEqual(["a.example"]);
    expect(
      createErrorJob({ ...context, pageUrl: "about:blank", frameUrl: "file:///x" }, "editable")
        .hostnames,
    ).toEqual([]);
    expect(createJobSource({ ...content, url: "file:///x" }, 1_000)?.hostname).toBe("");
  });

  it("jobHostname は長すぎるホスト名をサフィックスを残して切る", () => {
    const hostname = jobHostname(`https://${"a".repeat(300)}.bank.example/`);
    expect(hostname).toHaveLength(255);
    expect(hostname.endsWith(".bank.example")).toBe(true);
  });
});

describe("createContentJob / createErrorJob", () => {
  it("スキーマに適合するジョブを作る", () => {
    const source = createJobSource(content, 1_000);
    if (!source) {
      throw new Error("source should be defined");
    }
    const job = createContentJob(context, source);
    expect(JobSchema.parse(job)).toEqual(job);
    expect(job).not.toHaveProperty("frameUrl");

    const error = createErrorJob({ ...context, frameUrl: "https://frame.example/" }, "editable");
    expect(JobSchema.parse(error)).toEqual({
      ...context,
      frameUrl: "https://frame.example/",
      hostnames: ["example.com", "frame.example"],
      kind: "error",
      error: "editable",
    });
  });

  it("jobByteSize は UTF-8 のバイト数を返す", () => {
    const job = createErrorJob(context, "editable");
    expect(jobByteSize(job)).toBe(new TextEncoder().encode(JSON.stringify(job)).length);
  });
});
