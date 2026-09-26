import { describe, expect, it } from "vitest";
import {
  isExcludedPage,
  isExcludedUrl,
  matchesDomainPattern,
  normalizeDomainPattern,
  parseDomainList,
  urlHostname,
} from "./exclude";

describe("normalizeDomainPattern", () => {
  it.each([
    ["example.com", "example.com"],
    ["  Example.COM  ", "example.com"],
    ["*.example.com", "*.example.com"],
    ["example.com.", "example.com"],
    ["例え.jp", "xn--r8jz45g.jp"],
    ["*.例え.jp", "*.xn--r8jz45g.jp"],
    ["https://bank.example/login?next=/", "bank.example"],
    ["http://user:pass@Intranet.Example:8080/", "intranet.example"],
    ["localhost", "localhost"],
    ["192.168.0.1", "192.168.0.1"],
  ])("%j → %j", (input, expected) => {
    expect(normalizeDomainPattern(input)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "*",
    "*.",
    "a.*.example.com",
    "*example.com",
    "example.com/path",
    "example.com:8080",
    "user@example.com",
    "exa mple.com",
    ".example.com",
    "*.192.168.0.1",
    "[::1]",
    "file:///etc/passwd",
  ])("不正な入力 %j は undefined", (input) => {
    expect(normalizeDomainPattern(input)).toBeUndefined();
  });
});

describe("parseDomainList", () => {
  it("1 行 1 パターンで解釈し、空行を無視して重複を除く", () => {
    expect(parseDomainList("example.com\r\n\n *.bank.example \nEXAMPLE.com\nnot valid\n")).toEqual({
      domains: ["example.com", "*.bank.example"],
      invalid: ["not valid"],
    });
  });
});

describe("urlHostname", () => {
  it.each([
    ["https://www.example.com/path?q=1#f", "www.example.com"],
    ["https://example.com./", "example.com"],
    ["https://例え.jp/", "xn--r8jz45g.jp"],
    ["blob:https://bank.example/0000-1111", "bank.example"],
    ["view-source:https://bank.example/", "bank.example"],
    ["filesystem:https://bank.example/temporary/doc.html", "bank.example"],
    ["VIEW-SOURCE:https://bank.example/", "bank.example"],
    ["file:///Users/name/doc.html", undefined],
    ["about:blank", undefined],
    ["chrome://settings", "settings"],
    ["not a url", undefined],
    ["", undefined],
  ])("%j → %j", (url, expected) => {
    expect(urlHostname(url)).toBe(expected);
  });
});

describe("matchesDomainPattern", () => {
  it.each([
    ["example.com", "example.com", true],
    ["www.example.com", "example.com", false],
    ["example.com", "*.example.com", true],
    ["a.b.example.com", "*.example.com", true],
    ["badexample.com", "*.example.com", false],
    ["example.com.evil", "*.example.com", false],
  ])("%s と %s → %s", (hostname, pattern, expected) => {
    expect(matchesDomainPattern(hostname, pattern)).toBe(expected);
  });
});

describe("isExcludedUrl / isExcludedPage", () => {
  const patterns = ["*.bank.example", "intranet.example"];

  it("パターンに一致する URL を除外する", () => {
    expect(isExcludedUrl("https://www.bank.example/account", patterns)).toBe(true);
    expect(isExcludedUrl("https://intranet.example/", patterns)).toBe(true);
    expect(isExcludedUrl("https://news.example/", patterns)).toBe(false);
    expect(isExcludedUrl("https://news.example/", [])).toBe(false);
  });

  it("ページ URL とフレーム URL のどちらかが一致すれば除外する", () => {
    expect(isExcludedPage({ pageUrl: "https://bank.example/" }, patterns)).toBe(true);
    expect(
      isExcludedPage(
        { pageUrl: "https://news.example/", frameUrl: "https://login.bank.example/" },
        patterns,
      ),
    ).toBe(true);
    expect(
      isExcludedPage(
        { pageUrl: "https://news.example/", frameUrl: "https://ads.example/" },
        patterns,
      ),
    ).toBe(false);
  });
});
