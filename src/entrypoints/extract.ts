import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { extractPage } from "../lib/extract/page";

// scripting.executeScript で必要時のみ注入する読み取り専用スクリプト。
// main の戻り値が executeScript の結果になる。
export default defineUnlistedScript(() => extractPage(document));
