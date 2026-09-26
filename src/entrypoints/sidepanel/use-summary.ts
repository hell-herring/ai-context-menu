import { useCallback, useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import { isExcludedJob, JobReceiver, needsConfirmation } from "../../lib/job/receive";
import {
  approvalOf,
  type ModelFitApproval,
  type ModelOverflow,
  planRequest,
  type RequestPlan,
} from "../../lib/job/request";
import {
  modelChoices,
  resolveTarget,
  settingsFor,
  type Target,
  targetForProvider,
} from "../../lib/job/target";
import type { PresetId } from "../../lib/prompt/presets";
import { PROVIDERS } from "../../lib/providers/registry";
import type { RegisteredKeys } from "../../lib/providers/select";
import {
  PROVIDER_IDS,
  ProviderError,
  type ProviderErrorKind,
  type ProviderId,
  type StopReason,
  type Usage,
} from "../../lib/providers/types";
import type { ContentJob, CoreSettings, Job, JobErrorCode } from "../../lib/storage/schema";
import { getApiKeys, watchApiKeys } from "../../lib/storage/secrets";
import { readJob, removeJob, watchJob } from "../../lib/storage/session";
import { getCoreSettings, getExcludedDomains, watchCoreSettings } from "../../lib/storage/settings";

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

/** 送信前の判定で、選択中のモデルの入力上限に収まらなかった結果 */
export type ModelCheck = Exclude<RequestPlan, { kind: "ready" }>;

export type PanelState =
  | { kind: "idle" }
  | { kind: "jobError"; error: JobErrorCode }
  | {
      kind: "summary";
      job: ContentJob;
      /** 送信した（送信中の）送信先とプリセット。送信直前の判定を通った後に決まる */
      sent: (Target & { presetId: PresetId }) | undefined;
      /** サイドパネルで選んだ送信先（未選択なら設定の既定）。このジョブだけに効かせる */
      choice: Target | undefined;
      /** 使うプリセット（受け取った時点ではメニューで選んだもの） */
      presetId: PresetId;
      /**
       * 送信先・プリセットを切り替えた時点の判定で、入力上限に収まらなかった結果（確認中以外で表示する。
       * 再生成すると送信直前にも判定し、確認・エラーになる）
       */
      switchCheck: ModelCheck | undefined;
      phase: Phase;
      text: string;
      /**
       * ユーザーが「モデルに収まる長さまで送信」を選んだときの条件（再生成でも、条件が同じなら同じ扱いにする）
       */
      fitApproval: ModelFitApproval | undefined;
      /** モデルに収めるために本文を切り詰めて送った場合、送った本文の文字数 */
      fittedChars: number | undefined;
      /**
       * 受信時の確認（上限超過・設定「常に」・モデルの入力上限の超過）を済ませたか（確認なしで送った場合も true）。
       * 済ませていないジョブ（切り替えで本文を空にしても収まらないエラーになった等）は、
       * 再生成でも送らずに確認に戻す（入力を黙って切り詰めない。docs/guardrails.md）
       */
      confirmed: boolean;
    };

type ApiKeys = Awaited<ReturnType<typeof getApiKeys>>;

/** サイドパネルでの切り替えに使う、設定とキーの有無（キーの値は持たない） */
export interface PanelEnv {
  settings: CoreSettings;
  keys: RegisteredKeys;
}

function keysOf(apiKeys: ApiKeys): RegisteredKeys {
  return { anthropic: apiKeys.anthropic !== undefined, openai: apiKeys.openai !== undefined };
}

/**
 * 送信先のモデルのコンテキスト長による判定（ジョブ受信時・切り替え時）。
 * 収まらない（`overflow`）・本文を空にしても収まらない（`tooLong`）場合にその結果を返す
 */
function modelCheck(
  job: ContentJob,
  presetId: PresetId,
  choice: Target | undefined,
  env: PanelEnv,
  approval: ModelFitApproval | undefined,
): ModelCheck | undefined {
  const target = resolveTarget(env.settings, env.keys, choice);
  if (!target) {
    return undefined;
  }
  const plan = planRequest(
    { ...job, presetId },
    settingsFor(env.settings, target),
    target.provider,
    browser.i18n.getUILanguage(),
    approval,
  );
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
  const [env, setEnv] = useState<PanelEnv | undefined>(undefined);
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
    async (
      job: ContentJob,
      presetId: PresetId,
      choice: Target | undefined,
      fitApproval: ModelFitApproval | undefined,
    ) => {
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
        sent: undefined,
        choice,
        presetId,
        switchCheck: undefined,
        phase: { kind: "streaming" },
        text: "",
        fitApproval,
        fittedChars: undefined,
        confirmed: true,
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
        // サイドパネルで選んだプロバイダのキーが削除されていれば、他のプロバイダに黙って送らない
        const target = resolveTarget(settings, keysOf(apiKeys), choice);
        const apiKey = target && apiKeys[target.provider];
        if (!target || !apiKey) {
          update({ phase: { kind: "error", error: "apiKeyMissing" } });
          return;
        }
        const { provider, model } = target;

        // 送信直前にも、その時点の設定のモデルのコンテキスト長で判定する（docs/spec.md §3.3）
        // 確認したときとプロバイダ・モデル・使える量が変わっていれば、切り詰めずに確認に戻す
        const plan = planRequest(
          { ...job, presetId },
          settingsFor(settings, target),
          provider,
          browser.i18n.getUILanguage(),
          fitApproval,
        );
        if (plan.kind === "overflow") {
          // 黙って切り詰めず、確認に戻す
          update({ phase: { kind: "confirm", overflow: plan.overflow } });
          return;
        }
        if (plan.kind === "tooLong") {
          update({ phase: { kind: "error", error: "context_length" } });
          return;
        }
        update({ sent: { provider, model, presetId }, fittedChars: plan.fittedChars });

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
      const summary = {
        kind: "summary",
        job,
        sent: undefined,
        choice: undefined,
        presetId: job.presetId,
        switchCheck: undefined,
        text: "",
        confirmed: false,
      } as const;
      setState({
        ...summary,
        phase: { kind: "preparing" },
        fitApproval: undefined,
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
      const env = settings && apiKeys ? { settings, keys: keysOf(apiKeys) } : undefined;
      if (env) {
        setEnv(env);
      }
      // 設定を読めなければ確認する側に倒す
      const mode = settings?.confirmBeforeSend ?? "always";
      const check = env ? modelCheck(job, job.presetId, undefined, env, undefined) : undefined;
      if (check?.kind === "tooLong") {
        // どう切り詰めても送れないため、確認を出さずにエラーにする
        setState({
          ...summary,
          phase: { kind: "error", error: "context_length" },
          fitApproval: undefined,
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
          fitApproval: undefined,
          fittedChars: undefined,
        });
      } else {
        void send(job, job.presetId, undefined, undefined);
      }
    },
    [cancelRun, send],
  );

  // 切り替えの選択肢（キーのあるプロバイダ・保存済みのモデル）。他のページでの保存も反映する
  useEffect(() => {
    let disposed = false;
    let loads = 0;
    const load = async () => {
      const load = ++loads;
      try {
        const [settings, apiKeys] = await Promise.all([getCoreSettings(), getApiKeys()]);
        if (!disposed && load === loads) {
          setEnv({ settings, keys: keysOf(apiKeys) });
        }
      } catch (error) {
        console.error("Failed to load settings", error);
      }
    };
    const unwatchSettings = watchCoreSettings(() => void load());
    const unwatchKeys = watchApiKeys(() => void load());
    void load();
    return () => {
      disposed = true;
      unwatchSettings();
      unwatchKeys();
    };
  }, []);

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

  /**
   * 送信先・プリセットを切り替える（送信はしない。確認中なら確認の内容を、それ以外は再生成したときの
   * 見込みを、切り替えた時点のモデルのコンテキスト長で判定し直す。docs/spec.md §3.3）
   */
  const select = useCallback(
    (choice: Target | undefined, presetId: PresetId) => {
      if (
        !current ||
        !env ||
        current.phase.kind === "preparing" ||
        current.phase.kind === "streaming" ||
        current.phase.kind === "cancelled"
      ) {
        return;
      }
      const check = modelCheck(current.job, presetId, choice, env, current.fitApproval);
      const next = { ...current, choice, presetId };
      if (current.phase.kind === "confirm") {
        setState({
          ...next,
          switchCheck: undefined,
          phase:
            check?.kind === "tooLong"
              ? { kind: "error", error: "context_length" }
              : { kind: "confirm", overflow: check?.overflow },
        });
      } else {
        setState({ ...next, switchCheck: check });
      }
    },
    [current, env],
  );

  /** 表示・切り替えに使う現在の送信先（選んだもの、なければ設定の既定） */
  const selected =
    current && env && (current.choice ?? resolveTarget(env.settings, env.keys, undefined));

  return {
    state,
    env,
    /** 選択中の送信先。キーのあるプロバイダがなければ undefined */
    selected,
    selectProvider: useCallback(
      (provider: ProviderId) => {
        if (current && env && PROVIDER_IDS.includes(provider)) {
          select(targetForProvider(env.settings, provider), current.presetId);
        }
      },
      [current, env, select],
    ),
    selectModel: useCallback(
      (model: string) => {
        // 選べるのは設定で保存したモデルと既定モデルだけ
        if (
          current &&
          env &&
          selected &&
          modelChoices(env.settings, selected.provider).includes(model)
        ) {
          select({ provider: selected.provider, model }, current.presetId);
        }
      },
      [current, env, selected, select],
    ),
    selectPreset: useCallback(
      (presetId: PresetId) => {
        if (current) {
          select(current.choice, presetId);
        }
      },
      [current, select],
    ),
    /**
     * 確認後に送信する（oversize のジョブは切り詰め済みの本文を送る）。
     * モデルの入力上限の超過を表示していた場合は、モデルに収まる長さまで切り詰めて送る
     */
    confirm: useCallback(() => {
      if (current?.phase.kind === "confirm") {
        const { overflow } = current.phase;
        void send(
          current.job,
          current.presetId,
          current.choice,
          overflow ? approvalOf(overflow) : current.fitApproval,
        );
      }
    }, [current, send]),
    cancel: useCallback(() => {
      if (current?.phase.kind === "confirm") {
        setState({ ...current, phase: { kind: "cancelled" } });
      }
    }, [current]),
    stop: useCallback(() => controllerRef.current?.abort(), []),
    regenerate: useCallback(() => {
      if (!current || current.phase.kind === "preparing") {
        return;
      }
      if (current.confirmed) {
        void send(current.job, current.presetId, current.choice, current.fitApproval);
        return;
      }
      // まだ確認していないジョブは送らずに確認に戻す（選択中の送信先で判定し直す）
      const check =
        env && modelCheck(current.job, current.presetId, current.choice, env, current.fitApproval);
      setState(
        check?.kind === "tooLong"
          ? { ...current, switchCheck: check, phase: { kind: "error", error: "context_length" } }
          : {
              ...current,
              switchCheck: undefined,
              phase: { kind: "confirm", overflow: check?.overflow },
            },
      );
    }, [current, env, send]),
  };
}
