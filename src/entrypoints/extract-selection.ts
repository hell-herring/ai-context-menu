import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { extractSelection } from "../lib/extract/selection";

// scripting.executeScript で必要時のみ注入する読み取り専用スクリプト（選択テキストの取得）。
// main の戻り値が executeScript の結果になる。
export default defineUnlistedScript(() => extractSelection(document));
