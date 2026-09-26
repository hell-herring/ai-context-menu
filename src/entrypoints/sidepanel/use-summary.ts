import { useCallback, useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import { isExcludedPage, isExcludedUrl } from "../../lib/domain/exclude";
import { JobReceiver } from "../../lib/job/receive";
import { buildPrompt, describeOutputLanguage } from "../../lib/prompt/build";
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
        const [apiKeys, settings, excludedDomains] = await Promise.all([
          getApiKeys(),
          getCoreSettings(),
          getExcludedDomains(),
        ]);
        // 確認待ち・再生成の間に除外ドメインが追加された場合も送らない。
        // プロバイダ呼び出しの直前に、その時点の設定で毎回判定する（docs/guardrails.md §2）
        if (
          isExcludedPage(job, excludedDomains) ||
          isExcludedUrl(job.source.displayUrl, excludedDomains) ||
          isExcludedUrl(job.source.providerUrl, excludedDomains)
        ) {
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
          maxOutputTokens: settings.maxOutputTokens,
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
    (job: Job) => {
      cancelRun();
      if (job.kind === "error") {
        setState({ kind: "jobError", error: job.error });
      } else if (job.source.oversize) {
        // 上限超過・メタデータ短縮は黙って送らず、必ずユーザーに確認する
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
          receive(job);
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

  const current = state.kind === "summary" ? state : undefined;

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
      if (current) {
        void send(current.job);
      }
    }, [current, send]),
  };
}
