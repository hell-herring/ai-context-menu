import { useCallback, useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import { isExcludedJob, JobReceiver, needsConfirmation } from "../../lib/job/receive";
import { buildPrompt, describeOutputLanguage } from "../../lib/prompt/build";
import { effectiveMaxOutputTokens } from "../../lib/providers/limits";
import { PROVIDERS } from "../../lib/providers/registry";
import { resolveProvider } from "../../lib/providers/select";
import {
  ProviderError,
  type ProviderErrorKind,
  type ProviderId,
  type StopReason,
  type Usage,
} from "../../lib/providers/types";
import type { ContentJob, Job, JobErrorCode } from "../../lib/storage/schema";
import { getApiKeys } from "../../lib/storage/secrets";
import { readJob, removeJob, watchJob } from "../../lib/storage/session";
import { getCoreSettings, getExcludedDomains } from "../../lib/storage/settings";

export type Phase =
  /** 受け取ったジョブの送信前の判定中（設定の読み込み中） */
  | { kind: "preparing" }
  | { kind: "confirm" }
  | { kind: "cancelled" }
  | { kind: "streaming" }
  | { kind: "done"; stopReason: StopReason; usage: Usage | undefined }
  | { kind: "stopped" }
  | { kind: "error"; error: ProviderErrorKind | "apiKeyMissing" | "excludedDomain" };

export type PanelState =
  | { kind: "idle" }
  | { kind: "jobError"; error: JobErrorCode }
  | {
      kind: "summary";
      job: ContentJob;
      /** 送信先（API キー・設定を読んだ後に決まる） */
      target: { provider: ProviderId; model: string } | undefined;
      phase: Phase;
      text: string;
    };

/**
 * サイドパネルのジョブ受信と AI 呼び出し。
 *
 * - 自分のウィンドウの `job.<windowId>` だけを読み、受け取ったらプロバイダ呼び出しの前に削除する（1 回だけ消費）
 * - 同時に実行するリクエストは 1 件まで。新しいジョブ・再生成の開始時は進行中のものを中断する
 * - 外部送信はユーザー操作（メニュークリック・確認・再生成）を起点とする
 */
export function useSummary() {
  const [state, setState] = useState<PanelState>({ kind: "idle" });
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const runRef = useRef(0);
  /** 最後に受け取ったジョブの ID。前のジョブの表示に対する操作（確認・再生成）を受け付けないために使う */
  const latestJobIdRef = useRef<string | undefined>(undefined);

  /** 進行中のリクエストを中断し、以降の古い更新を無視させる */
  const cancelRun = useCallback(() => {
    runRef.current++;
    controllerRef.current?.abort();
    controllerRef.current = undefined;
  }, []);

  const send = useCallback(
    async (job: ContentJob) => {
      cancelRun();
      const run = runRef.current;
      const controller = new AbortController();
      controllerRef.current = controller;

      const update = (patch: Partial<Extract<PanelState, { kind: "summary" }>>) => {
        if (runRef.current !== run) {
          return;
        }
        setState((current) =>
          current.kind === "summary" && current.job.id === job.id
            ? { ...current, ...patch }
            : current,
        );
      };

      setState({ kind: "summary", job, target: undefined, phase: { kind: "streaming" }, text: "" });

      // 受信したテキストは描画フレームごとにまとめて反映する
      let text = "";
      let frame = 0;
      const flush = () => {
        frame = 0;
        update({ text });
      };

      try {
        const [apiKeys, settings] = await Promise.all([getApiKeys(), getCoreSettings()]);
        // 確認待ち・再生成の間に除外ドメインが追加された場合も送らない。
        // プロバイダ呼び出しの直前に、その時点の設定で毎回判定する（docs/guardrails.md §2）。
        // 他の読み込みより後に読み、判定からプロバイダ呼び出しまでの間に await を挟まない
        const excludedDomains = await getExcludedDomains();
        if (isExcludedJob(job, excludedDomains)) {
          update({ phase: { kind: "error", error: "excludedDomain" } });
          return;
        }
        const provider = resolveProvider(settings.defaultProvider, {
          anthropic: apiKeys.anthropic !== undefined,
          openai: apiKeys.openai !== undefined,
        });
        const apiKey = provider && apiKeys[provider];
        if (!provider || !apiKey) {
          update({ phase: { kind: "error", error: "apiKeyMissing" } });
          return;
        }
        const model = settings.models[provider];
        update({ target: { provider, model } });

        const prompt = buildPrompt({
          presetId: job.presetId,
          outputLanguage: describeOutputLanguage(
            settings.outputLanguage,
            browser.i18n.getUILanguage(),
          ),
          document: {
            title: job.source.title,
            url: job.source.providerUrl,
            source: job.source.type,
            content: job.source.text,
          },
        });

        const events = PROVIDERS[provider].stream(apiKey, {
          ...prompt,
          model,
          // 選択モデルの出力上限が分かる場合はそれを超えない（docs/spec.md §3.6）
          maxOutputTokens: effectiveMaxOutputTokens(settings, provider),
          signal: controller.signal,
        });
        for await (const event of events) {
          if (event.type === "text") {
            text += event.text;
            frame ||= requestAnimationFrame(flush);
          } else {
            cancelAnimationFrame(frame);
            update({
              text,
              phase: { kind: "done", stopReason: event.stopReason, usage: event.usage },
            });
          }
        }
      } catch (error) {
        cancelAnimationFrame(frame);
        const kind = error instanceof ProviderError ? error.kind : "unknown";
        update({
          text,
          phase: kind === "aborted" ? { kind: "stopped" } : { kind: "error", error: kind },
        });
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = undefined;
        }
      }
    },
    [cancelRun],
  );

  const receive = useCallback(
    async (job: Job) => {
      cancelRun();
      const run = runRef.current;
      latestJobIdRef.current = job.id;
      if (job.kind === "error") {
        setState({ kind: "jobError", error: job.error });
        return;
      }
      // 設定を読む前に表示を新しいジョブに置き換え、前のジョブの確認・再生成ボタンを押せないようにする
      setState({ kind: "summary", job, target: undefined, phase: { kind: "preparing" }, text: "" });
      // 設定を読めなければ確認する側に倒す
      const mode = await getCoreSettings().then(
        (settings) => settings.confirmBeforeSend,
        () => "always" as const,
      );
      // 設定を読む間に次のジョブを受け取っていたら何もしない
      if (runRef.current !== run) {
        return;
      }
      // 上限超過・メタデータ短縮は設定に関わらず、黙って送らずに確認する
      if (needsConfirmation(job, mode)) {
        setState({ kind: "summary", job, target: undefined, phase: { kind: "confirm" }, text: "" });
      } else {
        void send(job);
      }
    },
    [cancelRun, send],
  );

  useEffect(() => {
    let disposed = false;
    let unwatch: (() => void) | undefined;
    const receiver = new JobReceiver();

    (async () => {
      const { id: windowId } = await browser.windows.getCurrent();
      if (disposed || windowId === undefined) {
        return;
      }
      const handle = async (job: Job) => {
        const decision = receiver.decide(job, Date.now());
        if (decision === "duplicate") {
          return;
        }
        // 処理しないジョブも含め、読んだジョブは削除してパネルを開き直しても再送しないようにする
        await removeJob(windowId);
        if (decision === "accept" && !disposed) {
          await receive(job);
        }
      };
      // 取りこぼさないよう、監視を始めてから既存のジョブを読む
      unwatch = watchJob(windowId, (job) => void handle(job));
      const pending = await readJob(windowId);
      if (pending && !disposed) {
        await handle(pending);
      }
    })().catch((error: unknown) => {
      console.error("Failed to receive jobs", error);
    });

    return () => {
      disposed = true;
      unwatch?.();
      cancelRun();
    };
  }, [receive, cancelRun]);

  // 最後に受け取ったジョブの表示に対する操作だけを受け付ける
  const current =
    state.kind === "summary" && state.job.id === latestJobIdRef.current ? state : undefined;

  return {
    state,
    /** 確認後に送信する（oversize のジョブは切り詰め済みの本文を送る） */
    confirm: useCallback(() => {
      if (current?.phase.kind === "confirm") {
        void send(current.job);
      }
    }, [current, send]),
    cancel: useCallback(() => {
      if (current?.phase.kind === "confirm") {
        setState({ ...current, phase: { kind: "cancelled" } });
      }
    }, [current]),
    stop: useCallback(() => controllerRef.current?.abort(), []),
    regenerate: useCallback(() => {
      if (current && current.phase.kind !== "preparing") {
        void send(current.job);
      }
    }, [current, send]),
  };
}
