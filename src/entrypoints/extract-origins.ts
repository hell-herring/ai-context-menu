import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { collectOrigins } from "../lib/extract/origins";

// scripting.executeScript で必要時のみ注入する読み取り専用スクリプト（フレームのオリジンの取得）。
// URL にホスト名のないフレームで、除外ドメインの判定のためにコンテンツの取得より前に使う。
export default defineUnlistedScript(() => collectOrigins(window));
