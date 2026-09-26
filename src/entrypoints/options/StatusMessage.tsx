/** 設定画面の操作結果。`info` は処理中の表示 */
export type Notice = { message: string; tone: "success" | "error" | "info" };

const TONE_STYLES = {
  success: "text-green-700 dark:text-green-400",
  error: "text-red-700 dark:text-red-400",
  info: "text-neutral-600 dark:text-neutral-400",
} as const satisfies Record<Notice["tone"], string>;

/** 操作結果をスクリーンリーダーへ通知する領域（空でも置いておき、変化を読み上げさせる） */
export function StatusMessage({ notice }: { notice: Notice | undefined }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className={`text-sm ${TONE_STYLES[notice?.tone ?? "info"]}`}
    >
      {notice?.message}
    </p>
  );
}
