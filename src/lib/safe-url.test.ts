import { describe, expect, it } from "vitest";
import { isSafeLinkUrl } from "./safe-url";

describe("isSafeLinkUrl", () => {
  it.each(["https://example.com/", "http://example.com/a?b=c#d"])("%s は許可する", (url) => {
    expect(isSafeLinkUrl(url)).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "chrome-extension://abc/options.html",
    "file:///etc/passwd",
    "/relative",
    "",
    undefined,
    42,
  ])("%s は許可しない", (url) => {
    expect(isSafeLinkUrl(url)).toBe(false);
  });
});
