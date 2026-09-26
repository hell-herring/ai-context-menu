import { useCallback, useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import { isExcludedJob, JobReceiver, needsConfirmation } from "../../lib/job/receive";
import { type ModelOverflow, planRequest, type RequestPlan } from "../../lib/job/request";
import { PROVIDERS } from "../../lib/providers/registry";
import { resolveProvider } from "../../lib/providers/select";
import {
  ProviderError,
  type ProviderErrorKind,
  type ProviderId,
  type StopReason,
  type Usage,
} from "../../lib/providers/types";
import type { ContentJob, CoreSettings, Job, JobErrorCode } from "../../lib/storage/schema";
import { getApiKeys } from "../../lib/storage/secrets";
import { readJob, removeJob, watchJob } from "../../lib/storage/session";
import { getCoreSettings, getExcludedDomains } from "../../lib/storage/settings";

export type Phase =
  /** 受け取ったジョブの送信前の判定中（設定の読み込み中） */
  | { kind: "preparing" }
  /** 送信前の確認。`overflow` は選択中のモデルの入力上限に収まらない場合の内訳 */
  | { kind: "confirm"; overflow: ModelOverflow | undefined }
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
      /** ユーザーが「モデルに収まる長さまで送信」を選んだ（再生成でも同じ扱いにする） */
      fitToModel: boolean;
      /** モデルに収めるために本文を切り詰めて送った場合、送った本文の文字数 */
      fittedChars: number | undefined;
    };

type ApiKeys = Awaited<ReturnType<typeof getApiKeys>>;

/** 使用するプロバイダとキー（設定のプロバイダにキーがなければキーのある最初のもの） */
function resolveTarget(settings: CoreSettings, apiKeys: ApiKeys) {
  const provider = resolveProvider(settings.defaultProvider, {
    anthropic: apiKeys.anthropic !== undefined,
    openai: apiKeys.openai !== undefined,
  });
  const apiKey = provider && apiKeys[provider];
  return provider && apiKey ? { provider, apiKey } : undefined;
}

/**
 * ジョブを受け取った時点での、選択中のモデルのコンテキスト長による判定。
 * 収まらない（`overflow`）・本文を空にしても収まらない（`tooLong`）場合にその結果を返す
 */
function receivedModelCheck(
  job: ContentJob,
  settings: CoreSettings,
  apiKeys: ApiKeys,
): Exclude<RequestPlan, { kind: "ready" }> | undefined {
  const target = resolveTarget(settings, apiKeys);
  if (!target) {
    return undefined;
  }
  const plan = planRequest(job, settings, target.provider, browser.i18n.getUILanguage(), false);
  return plan.kind === "ready" ? undefined : plan;
}

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
    async (job: ContentJob, fitToModel: boolean) => {
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

      setState({
        kind: "summary",
        job,
        target: undefined,
        phase: { kind: "streaming" },
        text: "",
        fitToModel,
        fittedChars: undefined,
      });

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
        const target = resolveTarget(settings, apiKeys);
        if (!target) {
          update({ phase: { kind: "error", error: "apiKeyMissing" } });
          return;
        }
        const { provider, apiKey } = target;
        const model = settings.models[provider];
        update({ target: { provider, model } });

        // 送信直前にも、その時点の設定のモデルのコンテキスト長で判定する（docs/spec.md §3.3）
        const plan = planRequest(job, settings, provider, browser.i18n.getUILanguage(), fitToModel);
        if (plan.kind === "overflow") {
          // 黙って切り詰めず、確認に戻す
          update({ phase: { kind: "confirm", overflow: plan.overflow } });
          return;
        }
        if (plan.kind === "tooLong") {
          update({ phase: { kind: "error", error: "context_length" } });
          return;
        }
        update({ fittedChars: plan.fittedChars });

        const events = PROVIDERS[provider].stream(apiKey, {
          ...plan.prompt,
          model,
          // 選択モデルの出力上限が分かる場合はそれを超えない（docs/spec.md §3.6）
          maxOutputTokens: plan.maxOutputTokens,
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
      setState({
        kind: "summary",
        job,
        target: undefined,
        phase: { kind: "preparing" },
        text: "",
        fitToModel: false,
        fittedChars: undefined,
      });
      const [settings, apiKeys] = await Promise.all([
        getCoreSettings().catch(() => undefined),
        getApiKeys().catch(() => undefined),
      ]);
      // 設定を読む間に次のジョブを受け取っていたら何もしない
      if (runRef.current !== run) {
        return;
      }
      // 設定を読めなければ確認する側に倒す
      const mode = settings?.confirmBeforeSend ?? "always";
      const check = settings && apiKeys ? receivedModelCheck(job, settings, apiKeys) : undefined;
      const summary = { kind: "summary", job, target: undefined, text: "" } as const;
      if (check?.kind === "tooLong") {
        // どう切り詰めても送れないため、確認を出さずにエラーにする
        setState({
          ...summary,
          phase: { kind: "error", error: "context_length" },
          fitToModel: false,
          fittedChars: undefined,
        });
        return;
      }
      const overflow: ModelOverflow | undefined = check?.overflow;
      // 上限超過・メタデータ短縮・モデルの入力上限の超過は設定に関わらず、黙って送らずに確認する
      if (needsConfirmation(job, mode) || overflow) {
        setState({
          ...summary,
          phase: { kind: "confirm", overflow },
          fitToModel: false,
          fittedChars: undefined,
        });
      } else {
        void send(job, false);
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
    /**
     * 確認後に送信する（oversize のジョブは切り詰め済みの本文を送る）。
     * モデルの入力上限の超過を表示していた場合は、モデルに収まる長さまで切り詰めて送る
     */
    confirm: useCallback(() => {
      if (current?.phase.kind === "confirm") {
        void send(current.job, current.fitToModel || current.phase.overflow !== undefined);
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
        void send(current.job, current.fitToModel);
      }
    }, [current, send]),
  };
}
